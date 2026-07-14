# AnonimAE

AnonimAE es una plataforma local-first para anonimización reversible, prevención de fuga de datos y trazabilidad de uso de información sensible en flujos con herramientas de Inteligencia Artificial.

El proyecto combina un backend local en Node.js, una consola web de operación y una extensión Manifest V3 para navegadores Chromium. Su objetivo es permitir que equipos legales, sanitarios, corporativos o de compliance puedan trabajar con documentos, prompts y respuestas de IA sin exponer datos personales, identificadores, credenciales, expedientes o información empresarial sensible a servicios externos.

Versión actual: `26.6.41`.

## Qué problema resuelve

Cuando un usuario pega texto o sube documentos a una IA comercial, puede enviar sin querer nombres, DNI/NIE, teléfonos, correos, IBAN, tarjetas, direcciones, expedientes judiciales, diligencias, empresas u otros identificadores. AnonimAE actúa como una capa DLP local:

- Detecta entidades sensibles mediante reglas configurables, diccionarios y heurísticas.
- Sustituye cada dato por placeholders consistentes como `[Nombre_001]`, `[Empresa_001]` o `[DNI_001]`.
- Conserva un mapa reversible cifrado con AES-256-GCM y derivación `scrypt`.
- Genera una referencia de transacción (`[Referencia: UUID]`) para restaurar los datos cuando sea necesario.
- Registra auditoría local con hashes, origen, usuario y entidades reemplazadas.

## Principios de diseño

- **Local-first**: el procesamiento principal se ejecuta en la máquina del usuario o dentro del navegador.
- **Reversible bajo control**: la anonimización se puede revertir solo con la clave maestra correcta.
- **Auditable**: cada operación queda trazada con hashes y metadatos locales.
- **Configurable**: las reglas de detección viven en `config/rules.yaml`.
- **Offline-capable**: la extensión incluye motor local, reglas compiladas y librerías necesarias para operar sin depender de un backend remoto.
- **Defensa por defecto**: `src/backend/data/`, claves, entornos, cachés y dependencias están excluidos del repositorio.

## Componentes principales

### Backend local

Ubicado en `src/backend`, expone una API Express para:

- Consultar versión y hardware local.
- Leer y actualizar reglas DLP.
- Anonimizar texto y documentos.
- Desanonimizar contenido mediante `ANON_REF` y clave maestra.
- Consultar auditoría local.

Endpoints principales:

- `GET /api/version`
- `GET /api/hardware`
- `GET /api/rules`
- `POST /api/rules`
- `GET /api/audit`
- `POST /api/anonymize`
- `POST /api/deanonymize`

### Motor de detección y documentos

Ubicado en `src/backend/engine`, contiene:

- `detection.js`: reglas regex, diccionarios, resolución de solapes y heurísticas de nombres.
- `placeholder.js`: generación consistente de placeholders.
- `crypto.js`: cifrado y descifrado AES-256-GCM.
- `audit.js`: registro local de operaciones.
- `document_processor.js`: procesamiento de formatos de texto, datos y documentos.

Formatos soportados por el motor:

- Texto plano y Markdown: `.txt`, `.md`, `.markdown`
- Datos estructurados: `.json`, `.csv`
- Marcado: `.html`, `.htm`, `.xml`
- Office: `.docx`, `.xlsx`, `.xls`
- PDF: extracción y anonimización del texto extraído

### Consola web local

El servidor publica `src/frontend` como interfaz local. Desde esta consola se puede:

- Anonimizar y restaurar contenido.
- Revisar auditoría.
- Gestionar reglas y diccionarios.
- Ver estado de motor, versión y capacidades.
- Operar con la misma experiencia visual que la consola empaquetada en la extensión.

URL por defecto:

```bash
http://127.0.0.1:3000
```

### Extensión de navegador

La extensión vive en `src/extension` y se sincroniza a la carpeta cargable `extension/`.

Incluye:

- Popup de configuración.
- Content script para detectar cajas de prompt y subidas de archivos.
- Dashboard autónomo integrado.
- Motor local embebido (`lib/localEngine.js`).
- Criptografía local (`lib/localCrypto.js`).
- Reglas compiladas (`lib/default_rules.json`).
- Librerías empacadas para PDF, DOCX/ZIP y XLSX.

La carpeta `extension/` está pensada para cargarse directamente desde `chrome://extensions` usando "Cargar descomprimida".

## Estructura del repositorio

```text
.
├── config/
│   └── rules.yaml                  # Reglas DLP editables
├── documentacion/
│   ├── manual_instalador.md         # Instalación y despliegue
│   └── manual_usuario.md            # Uso funcional
├── extension/                       # Extensión generada/cargable en navegador
├── qa/
│   └── visual-harness.html          # Harness visual para revisar pantallas
├── scripts/
│   ├── increment-version.js         # Incremento y sincronización de versión
│   └── package-extension.js         # Compila reglas y sincroniza extensión/frontend
├── src/
│   ├── backend/                     # API local y motores
│   ├── extension/                   # Fuente de la extensión
│   └── frontend/                    # Consola web servida por Express
├── tests/
│   └── engine.test.js               # Suite offline de integración
├── package.json
├── pnpm-lock.yaml
└── pnpm-workspace.yaml
```

## Requisitos

- Node.js `20.16+` o `22.3+` recomendado.
- npm o pnpm.
- Navegador Chromium compatible con Manifest V3: Chrome, Edge, Brave, Opera.

El backend usa `pdf-parse`, `adm-zip`, `xlsx`, `yaml` y `express`. La extensión incluye librerías de navegador ya empaquetadas en `src/extension/lib`.

## Instalación rápida

```bash
npm install
npm start
```

Modo desarrollo con recarga:

```bash
npm run dev
```

El servidor queda disponible en:

```bash
http://127.0.0.1:3000
```

## Preparar la extensión

Antes de cargar la extensión o después de modificar reglas, estilos, versión o código fuente:

```bash
npm run package-extension
```

Este comando:

1. Incrementa la versión en `package.json` y `src/extension/manifest.json`.
2. Compila `config/rules.yaml` a `src/extension/lib/default_rules.json`.
3. Sincroniza estilos entre frontend y extensión.
4. Regenera `src/frontend` desde la consola de la extensión.
5. Limpia y reconstruye la carpeta `extension/`.

Después, en Chrome/Edge/Brave:

1. Abre `chrome://extensions/`.
2. Activa "Modo de desarrollador".
3. Pulsa "Cargar descomprimida".
4. Selecciona la carpeta `extension/` del repositorio.

## Flujo de uso

### Anonimizar

1. El usuario introduce texto, prompt o documento.
2. AnonimAE detecta entidades sensibles.
3. El contenido se reemplaza por placeholders consistentes.
4. Se cifra el mapa reversible con la clave maestra.
5. Se devuelve el texto seguro junto con `[Referencia: UUID]`.

Ejemplo conceptual:

```text
Juan Perez trabaja en ACME y su DNI es 12345678Z.
```

Puede convertirse en:

```text
[Nombre_001] trabaja en [Empresa_001] y su DNI es [DNI_001].

[Referencia: 00000000-0000-0000-0000-000000000000]
```

### Desanonimizar

1. El usuario pega una respuesta o documento anonimizado.
2. AnonimAE extrae el `ANON_REF` / `[Referencia: UUID]`.
3. Busca el mapa local cifrado.
4. Descifra con la clave maestra.
5. Restaura los datos originales.

## Entidades incluidas

El archivo `config/rules.yaml` incluye reglas para:

- Correos electrónicos
- Teléfonos y móviles
- Fax
- DNI, NIE, NIF y CIF
- IBAN
- Tarjetas de crédito
- Expedientes y procedimientos judiciales
- Diligencias
- Códigos postales
- Pasaportes
- Direcciones físicas
- Organizaciones y empresas
- Nombres propios mediante diccionario y extensión heurística

Las reglas pueden modificarse sin tocar el código del motor. Si cambias `rules.yaml`, ejecuta `npm run package-extension` para actualizar también la extensión.

## Seguridad y privacidad

AnonimAE está pensado para preservar la privacidad operacional:

- Los mapas reversibles se cifran antes de guardarse.
- La clave maestra no debe compartirse ni almacenarse en claro.
- `src/backend/data/` está ignorado por git porque contiene auditoría y mappings locales.
- `.env`, claves, certificados, cachés y dependencias están excluidos por `.gitignore`.
- La auditoría guarda hashes de contenido y metadatos de transacción, no necesita publicar el contenido original.

Importante: si se pierde la clave maestra o el bloque `[Referencia: UUID]`, la restauración puede no ser posible.

## Pruebas

La suite principal es offline y valida detección, placeholders, criptografía y procesamiento documental:

```bash
node tests/engine.test.js
```

Cobertura funcional incluida:

- Detección regex y diccionarios.
- Resolución de solapes.
- Placeholders consistentes.
- Cifrado y descifrado AES-256-GCM.
- JSON, CSV y HTML/XML.
- DOCX y XLSX en memoria.
- Entidades complejas como faxes, diligencias, teléfonos y nombres con diacríticos.

## Documentación adicional

- [Manual de instalación](documentacion/manual_instalador.md)
- [Manual de usuario](documentacion/manual_usuario.md)
- [Guía de la extensión](src/extension/README.md)
- [Versionado y releases en GitHub](VERSIONING.md)

## Operación y mantenimiento

- Edita reglas en `config/rules.yaml`.
- Modifica la fuente de la extensión en `src/extension`.
- Usa `npm run package-extension` para regenerar `extension/` y `src/frontend`.
- No edites datos locales dentro de `src/backend/data/` para versionarlos; son runtime local.
- Verifica versiones en `package.json`, `src/extension/manifest.json` y `extension/manifest.json` antes de publicar.

## Licencia

MIT.
