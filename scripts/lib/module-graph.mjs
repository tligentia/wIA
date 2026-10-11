/**
 * module-graph — análisis estático exacto de los módulos de js/.
 *
 * Usa el parser acorn que lleva Node dentro (hay que arrancar con
 * `--expose-internals`; los scripts que lo importan se relanzan solos). Con él se
 * hace un análisis de ÁMBITOS de verdad —no una búsqueda de palabras—: para cada
 * módulo calcula qué nombres declara en su nivel superior y qué identificadores
 * usa sin haberlos declarado (los «libres»), y de ellos cuáles se usan al cargar
 * (fuera de cualquier función) y cuáles se asignan.
 */
import { createRequire } from 'node:module';

let acorn;
try {
    const require = createRequire(import.meta.url);
    acorn = require('internal/deps/acorn/acorn/dist/acorn');
} catch (e) {
    throw new Error('Falta el parser: ejecuta con `node --expose-internals` (los scripts de npm ya lo hacen). ' + e.message);
}

export { IMPORTS_START, IMPORTS_END, EXPORTS_START, EXPORTS_END, stripGenerated } from './generated-blocks.mjs';

class Scope {
    constructor(parent, kind) { this.parent = parent; this.kind = kind; this.names = new Set(); }
    has(name) { return this.names.has(name); }
}

function declarePattern(p, scope) {
    if (!p) return;
    switch (p.type) {
        case 'Identifier': scope.names.add(p.name); break;
        case 'ObjectPattern': for (const prop of p.properties) declarePattern(prop.type === 'RestElement' ? prop.argument : prop.value, scope); break;
        case 'ArrayPattern': for (const el of p.elements) declarePattern(el, scope); break;
        case 'AssignmentPattern': declarePattern(p.left, scope); break;
        case 'RestElement': declarePattern(p.argument, scope); break;
        default: break;
    }
}

/** `var` se eleva a la función: se recoge sin entrar en funciones anidadas. */
function collectVars(node, scope) {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
        case 'VariableDeclaration':
            if (node.kind === 'var') for (const d of node.declarations) declarePattern(d.id, scope);
            return;
        case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': case 'ClassDeclaration': case 'ClassExpression':
            return;
        default:
            for (const k of Object.keys(node)) {
                const v = node[k];
                if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && collectVars(c, scope));
                else if (v && typeof v.type === 'string') collectVars(v, scope);
            }
    }
}

/** let/const/class/function de las sentencias directas de un bloque. */
function collectLexical(stmts, scope) {
    for (const s of stmts) {
        if (s.type === 'VariableDeclaration' && s.kind !== 'var') for (const d of s.declarations) declarePattern(d.id, scope);
        else if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) scope.names.add(s.id.name);
    }
}

/**
 * analyze — { top: Map(nombre → tipo), free: Map(nombre → { load, assigned }) }
 *   load     el identificador se usa al ejecutarse el módulo (no dentro de una función)
 *   assigned se le asigna un valor (=, +=, ++…)
 */
export function analyze(cleanSource, filename = 'módulo') {
    let ast;
    try { ast = acorn.parse(cleanSource, { ecmaVersion: 'latest', sourceType: 'module' }); }
    catch (e) { throw new Error(`${filename}: no se pudo analizar (${e.message})`); }

    const moduleScope = new Scope(null, 'module');
    const top = new Map();
    for (const s of ast.body) {
        if (s.type === 'VariableDeclaration') { const tmp = new Scope(null, 'x'); for (const d of s.declarations) declarePattern(d.id, tmp); tmp.names.forEach((n) => top.set(n, s.kind)); }
        else if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) top.set(s.id.name, s.type === 'FunctionDeclaration' ? 'function' : 'class');
    }
    top.forEach((_, n) => moduleScope.names.add(n));
    collectVars({ type: 'Program', body: ast.body }, moduleScope);

    const free = new Map();
    const note = (name, scope, fnDepth, assigned) => {
        for (let s = scope; s; s = s.parent) if (s.has(name)) return; // declarado (local o del propio módulo)
        const cur = free.get(name) || { load: false, assigned: false };
        if (fnDepth === 0) cur.load = true;
        if (assigned) cur.assigned = true;
        free.set(name, cur);
    };

    // Patrón en posición de asignación (no declaración): sus identificadores se asignan.
    const visitAssignTarget = (p, scope, fd) => {
        if (!p) return;
        switch (p.type) {
            case 'Identifier': note(p.name, scope, fd, true); break;
            case 'ObjectPattern': for (const prop of p.properties) { if (prop.type === 'RestElement') visitAssignTarget(prop.argument, scope, fd); else { if (prop.computed) visit(prop.key, scope, fd); visitAssignTarget(prop.value, scope, fd); } } break;
            case 'ArrayPattern': for (const el of p.elements) visitAssignTarget(el, scope, fd); break;
            case 'AssignmentPattern': visitAssignTarget(p.left, scope, fd); visit(p.right, scope, fd); break;
            case 'RestElement': visitAssignTarget(p.argument, scope, fd); break;
            default: visit(p, scope, fd); // MemberExpression…
        }
    };
    // Patrón de declaración: solo cuentan valores por defecto y claves calculadas.
    const visitDeclPattern = (p, scope, fd) => {
        if (!p) return;
        switch (p.type) {
            case 'ObjectPattern': for (const prop of p.properties) { if (prop.type === 'RestElement') visitDeclPattern(prop.argument, scope, fd); else { if (prop.computed) visit(prop.key, scope, fd); visitDeclPattern(prop.value, scope, fd); } } break;
            case 'ArrayPattern': for (const el of p.elements) visitDeclPattern(el, scope, fd); break;
            case 'AssignmentPattern': visitDeclPattern(p.left, scope, fd); visit(p.right, scope, fd); break;
            case 'RestElement': visitDeclPattern(p.argument, scope, fd); break;
            default: break;
        }
    };

    const visitFunction = (node, scope, fd) => {
        const fs = new Scope(scope, 'function');
        if (node.type === 'FunctionExpression' && node.id) fs.names.add(node.id.name);
        node.params.forEach((p) => declarePattern(p, fs));
        if (node.body.type === 'BlockStatement') { collectVars(node.body, fs); collectLexical(node.body.body, fs); }
        node.params.forEach((p) => visitDeclPattern(p, fs, fd + 1));
        if (node.body.type === 'BlockStatement') node.body.body.forEach((s) => visit(s, fs, fd + 1));
        else visit(node.body, fs, fd + 1);
    };

    const visitChildren = (node, scope, fd) => {
        for (const k of Object.keys(node)) {
            if (k === 'type' || k === 'start' || k === 'end') continue;
            const v = node[k];
            if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && visit(c, scope, fd));
            else if (v && typeof v.type === 'string') visit(v, scope, fd);
        }
    };

    function visit(node, scope, fd) {
        if (!node) return;
        switch (node.type) {
            case 'Identifier': note(node.name, scope, fd, false); return;
            case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': visitFunction(node, scope, fd); return;
            case 'ClassDeclaration': case 'ClassExpression': {
                const cs = new Scope(scope, 'block');
                if (node.id) cs.names.add(node.id.name);
                if (node.superClass) visit(node.superClass, scope, fd);
                for (const m of node.body.body) {
                    if (m.computed) visit(m.key, cs, fd);
                    if (m.type === 'StaticBlock') { const bs = new Scope(cs, 'function'); collectVars(m, bs); collectLexical(m.body, bs); m.body.forEach((s) => visit(s, bs, fd)); }
                    else if (m.value) { m.value.type === 'FunctionExpression' ? visitFunction(m.value, cs, fd) : visit(m.value, cs, m.type === 'PropertyDefinition' ? fd : fd + 1); }
                }
                return;
            }
            case 'BlockStatement': { const bs = new Scope(scope, 'block'); collectLexical(node.body, bs); node.body.forEach((s) => visit(s, bs, fd)); return; }
            case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
                const ls = new Scope(scope, 'block');
                const head = node.type === 'ForStatement' ? node.init : node.left;
                if (head && head.type === 'VariableDeclaration' && head.kind !== 'var') head.declarations.forEach((d) => declarePattern(d.id, ls));
                if (node.type === 'ForStatement') { visit(node.init, ls, fd); visit(node.test, ls, fd); visit(node.update, ls, fd); }
                else {
                    if (head.type === 'VariableDeclaration') visit(head, ls, fd); else visitAssignTarget(head, ls, fd);
                    visit(node.right, ls, fd);
                }
                visit(node.body, ls, fd);
                return;
            }
            case 'CatchClause': { const cs = new Scope(scope, 'block'); declarePattern(node.param, cs); visitDeclPattern(node.param, cs, fd); visit(node.body, cs, fd); return; }
            case 'SwitchStatement': { visit(node.discriminant, scope, fd); const ss = new Scope(scope, 'block'); node.cases.forEach((c) => collectLexical(c.consequent, ss)); node.cases.forEach((c) => { visit(c.test, ss, fd); c.consequent.forEach((s) => visit(s, ss, fd)); }); return; }
            case 'VariableDeclaration': for (const d of node.declarations) { visitDeclPattern(d.id, scope, fd); visit(d.init, scope, fd); } return;
            case 'MemberExpression': visit(node.object, scope, fd); if (node.computed) visit(node.property, scope, fd); return;
            case 'Property': if (node.computed) visit(node.key, scope, fd); visit(node.value, scope, fd); return;
            case 'MethodDefinition': case 'PropertyDefinition': return; // tratados en la clase
            case 'LabeledStatement': visit(node.body, scope, fd); return;
            case 'BreakStatement': case 'ContinueStatement': return;
            case 'AssignmentExpression': visitAssignTarget(node.left, scope, fd); if (node.operator !== '=') visit(node.left, scope, fd); visit(node.right, scope, fd); return;
            case 'UpdateExpression': if (node.argument.type === 'Identifier') note(node.argument.name, scope, fd, true); else visit(node.argument, scope, fd); return;
            case 'ImportDeclaration': case 'ExportNamedDeclaration': case 'ExportAllDeclaration': case 'ExportDefaultDeclaration': return;
            case 'MetaProperty': return;
            default: visitChildren(node, scope, fd);
        }
    }

    collectLexical(ast.body, moduleScope);
    ast.body.forEach((s) => visit(s, moduleScope, 0));
    return { top, free };
}
