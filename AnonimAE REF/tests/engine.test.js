import assert from 'assert';
import path from 'path';
import fs from 'fs';
import { DetectionEngine } from '../src/backend/engine/detection.js';
import { PlaceholderEngine } from '../src/backend/engine/placeholder.js';
import { CryptoEngine } from '../src/backend/engine/crypto.js';
import { DocumentProcessor } from '../src/backend/engine/document_processor.js';

console.log('===========================================================');
console.log('🧪 RUNNING AnonimAE TEST SUITE (100% OFFLINE)');
console.log('===========================================================');

const configPath = path.join(process.cwd(), 'config', 'rules.yaml');

// 1. Check config file existence
assert.ok(fs.existsSync(configPath), 'rules.yaml config file should exist');
console.log('✅ Configuration rules file found.');

// Initialize Detection Engine
const detectionEngine = new DetectionEngine(configPath);

// ==========================================
// TEST 1: Basic Regex & Dictionary Detections
// ==========================================
console.log('\n🏃 Test 1: Testing regex and dictionary matches...');
const sampleText = 'Hola Juan Pérez de la Cruz, tu DNI es 12345678Z. Escríbeme a juan@gmail.com o llama al 600123456 en Mercadona S.A. en Calle de Alcalá, 45.';
const detected = detectionEngine.detect(sampleText);

const ids = detected.map(d => d.id);
assert.ok(ids.includes('nombre'), 'Should detect name "Juan" from dictionary');
const nameMatch = detected.find(d => d.id === 'nombre');
assert.strictEqual(nameMatch.text, 'Juan Pérez de la Cruz', 'Should detect full name with last names');

assert.ok(ids.includes('dni'), 'Should detect Spanish DNI "12345678Z" from regex');
assert.ok(ids.includes('email'), 'Should detect email "juan@gmail.com" from regex');
assert.ok(ids.includes('telefono'), 'Should detect mobile number "600123456" from regex');

assert.ok(ids.includes('organizacion'), 'Should detect organization "Mercadona S.A." dynamically');
const orgMatch = detected.find(d => d.id === 'organizacion');
assert.strictEqual(orgMatch.text, 'Mercadona S.A.', 'Should match the dynamic company name');

assert.ok(ids.includes('direccion'), 'Should detect address "Calle de Alcalá, 45" dynamically');
const addrMatch = detected.find(d => d.id === 'direccion');
assert.strictEqual(addrMatch.text, 'Calle de Alcalá, 45', 'Should match physical street address');

console.log('✅ Regex and Dictionary detection verification passed!');
console.log(`   Detected entities: ${detected.map(d => `${d.name} (${d.text})`).join(', ')}`);

// ==========================================
// TEST 2: Overlapping matches resolution
// ==========================================
console.log('\n🏃 Test 2: Testing overlapping matches resolution...');
// In "juan.perez@acme.com", the substring "Juan" (name dict) and "ACME" (org dict) overlap with the email regex.
// The engine must prioritize the email regex since it is the longer match (greedy scheduling).
const overlapText = 'Envía un correo a juan.perez@acme.com urgente.';
const detectedOverlaps = detectionEngine.detect(overlapText);

assert.strictEqual(detectedOverlaps.length, 1, 'Should resolve overlaps and keep only 1 match (the email)');
assert.strictEqual(detectedOverlaps[0].id, 'email', 'The single match should be the email');
assert.strictEqual(detectedOverlaps[0].text, 'juan.perez@acme.com', 'Should match the full email string');

console.log('✅ Overlap resolution greedy scheduling passed!');

// ==========================================
// TEST 3: Consistent placeholders generator
// ==========================================
console.log('\n🏃 Test 3: Testing consistent placeholders engine...');
const repeatText = 'Juan trabaja en ACME. Juan es el gerente de ACME.';
const detectedRepeat = detectionEngine.detect(repeatText);
const { anonymizedText, mapping } = PlaceholderEngine.process(repeatText, detectedRepeat);

// "Juan" should map to [Nombre_001] and "ACME" to [Empresa_001]
// They should be replaced consistently (both occurrences replaced with same token)
assert.ok(anonymizedText.includes('[Nombre_001]'), 'Should contain placeholder for Juan');
assert.ok(anonymizedText.includes('[Empresa_001]'), 'Should contain placeholder for ACME');
assert.strictEqual(mapping['[Nombre_001]'], 'Juan', 'Mapping should link Nombre_001 back to Juan');
assert.strictEqual(mapping['[Empresa_001]'], 'ACME', 'Mapping should link Empresa_001 back to ACME');

// Verify consistency in replacement count
const juanOccurrences = (anonymizedText.match(/\[Nombre_001\]/g) || []).length;
const acmeOccurrences = (anonymizedText.match(/\[Empresa_001\]/g) || []).length;
assert.strictEqual(juanOccurrences, 2, 'Both occurrences of Juan should have the identical placeholder');
assert.strictEqual(acmeOccurrences, 2, 'Both occurrences of ACME should have the identical placeholder');

console.log('✅ Placeholder consistency and numbering passed!');
console.log(`   Anonymized: "${anonymizedText}"`);
console.log(`   Mapping: ${JSON.stringify(mapping)}`);

// ==========================================
// TEST 4: Cryptographic AES-256-GCM Integration
// ==========================================
console.log('\n🏃 Test 4: Testing AES-256-GCM and scrypt key derivation...');
const masterPassword = 'MySecretSuperPassword123!';
const testMapping = {
  "[Nombre_001]": "Juan Pérez",
  "[Empresa_001]": "ACME Corporativa S.L.",
  "[DNI_001]": "98765432X"
};

// Encrypt
const encryptedPayload = CryptoEngine.encrypt(testMapping, masterPassword);
assert.ok(encryptedPayload.iv, 'Payload must contain IV');
assert.ok(encryptedPayload.authTag, 'Payload must contain Auth Tag');
assert.ok(encryptedPayload.salt, 'Payload must contain salt');
assert.ok(encryptedPayload.encryptedData, 'Payload must contain ciphertext');

// Decrypt with correct credentials
const decryptedMapping = CryptoEngine.decrypt(encryptedPayload, masterPassword);
assert.deepStrictEqual(decryptedMapping, testMapping, 'Decrypted mappings must match original');

// Decrypt with incorrect credentials (must fail)
assert.throws(() => {
  CryptoEngine.decrypt(encryptedPayload, 'WrongPassword!');
}, /Unsupported state|unable to authenticate/i, 'Should throw an error (AEAD decryption failure) on wrong password');
// Note: Depending on node version, message might be "Unsupported state or keepalive" or similar AEAD error

console.log('✅ Cryptographic envelope and authorization checks passed!');

// ==========================================
// TEST 5: DocumentProcessor Integration (JSON, CSV, HTML/XML)
// ==========================================
console.log('\n🏃 Test 5: Testing document formats parsers...');

// 5.1 JSON Parser
const testJSON = JSON.stringify({
  "userName": "Juan Pérez",
  "meta": {
    "email": "juan.perez@acme.com",
    "dni": "12345678Z"
  }
});
const procJSON = await DocumentProcessor.anonymize(testJSON, 'json', detectionEngine);
assert.ok(procJSON.anonymizedContent.includes('[Nombre_001]'), 'JSON value name must be replaced');
assert.ok(procJSON.anonymizedContent.includes('[Email_001]'), 'JSON value email must be replaced');
assert.ok(procJSON.anonymizedContent.includes('"userName":'), 'JSON keys must be preserved');
const restoredJSON = DocumentProcessor.deanonymize(procJSON.anonymizedContent, 'json', procJSON.mapping);
assert.deepStrictEqual(JSON.parse(restoredJSON), JSON.parse(testJSON), 'Restored JSON must match original');

// 5.2 CSV Parser
const testCSV = "Name;Email;DNI\nJuan;juan@acme.com;12345678Z\nMaria;maria@gmail.com;87654321X";
const procCSV = await DocumentProcessor.anonymize(testCSV, 'csv', detectionEngine);
assert.ok(procCSV.anonymizedContent.includes('Name;Email;DNI'), 'CSV headers must remain untouched');
assert.ok(procCSV.anonymizedContent.includes('[Nombre_001]'), 'CSV cells names replaced');
const restoredCSV = DocumentProcessor.deanonymize(procCSV.anonymizedContent, 'csv', procCSV.mapping);
assert.strictEqual(restoredCSV, testCSV, 'Restored CSV must match original exactly');

// 5.3 HTML/XML Parser
const testHTML = '<div class="profile" data-user="Juan"><h1>Hola Juan</h1><p>Email: juan@acme.com</p><style>.profile { color: red; }</style></div>';
const procHTML = await DocumentProcessor.anonymize(testHTML, 'html', detectionEngine);
assert.ok(procHTML.anonymizedContent.includes('class="profile"'), 'HTML tag attributes must remain untouched');
assert.ok(procHTML.anonymizedContent.includes('data-user="Juan"'), 'HTML custom data attributes must remain untouched');
assert.ok(procHTML.anonymizedContent.includes('.profile'), 'HTML CSS block content must remain untouched');
assert.ok(procHTML.anonymizedContent.includes('<h1>Hola [Nombre_001]</h1>'), 'HTML innerText nodes must be anonymized');
const restoredHTML = DocumentProcessor.deanonymize(procHTML.anonymizedContent, 'html', procHTML.mapping);
assert.strictEqual(restoredHTML, testHTML, 'Restored HTML must match original exactly');

console.log('✅ DocumentProcessor format parsers passed!');

// ==========================================
// TEST 6: Binary Office Documents (DOCX, XLSX)
// ==========================================
console.log('\n🏃 Test 6: Testing binary office documents (DOCX, XLSX) in-memory...');

// 6.1 In-memory DOCX Test
import AdmZip from 'adm-zip';
const docxZip = new AdmZip();
const originalXml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Estimado Juan Pérez, su DNI es 12345678Z. Atentamente Juan Pérez de ACME.</w:t></w:r></w:p></w:body></w:document>';
docxZip.addFile('word/document.xml', Buffer.from(originalXml, 'utf8'));
const originalDocxBuffer = docxZip.toBuffer();

const procDocx = await DocumentProcessor.anonymize(originalDocxBuffer, 'docx', detectionEngine);
assert.strictEqual(procDocx.isBinaryOut, true, 'DOCX anonymize should flag output as binary');
const anonymizedDocxBuffer = Buffer.from(procDocx.anonymizedContent, 'base64');
const anonZip = new AdmZip(anonymizedDocxBuffer);
const anonXml = anonZip.getEntry('word/document.xml').getData().toString('utf8');

assert.ok(anonXml.includes('[Nombre_001]'), 'DOCX name must be replaced by consistent placeholder');
assert.ok(anonXml.includes('[DNI_001]'), 'DOCX DNI must be replaced by placeholder');
assert.ok(anonXml.includes('[Empresa_001]'), 'DOCX company must be replaced by placeholder');

const restoredDocxBase64 = DocumentProcessor.deanonymize(procDocx.anonymizedContent, 'docx', procDocx.mapping);
const restoredZip = new AdmZip(Buffer.from(restoredDocxBase64, 'base64'));
const restoredXml = restoredZip.getEntry('word/document.xml').getData().toString('utf8');
assert.strictEqual(restoredXml, originalXml, 'Restored DOCX XML must match original XML exactly');
console.log('✅ In-memory DOCX anonymization and de-anonymization verified successfully!');

// 6.2 In-memory XLSX Test
import * as XLSX from 'xlsx';
const wb = XLSX.utils.book_new();
const wsData = [
  ["Nombre", "Empresa", "DNI"],
  ["Juan Pérez", "ACME", "12345678Z"],
  ["Juan Pérez", "Ninguna", "Otro texto"]
];
const ws = XLSX.utils.aoa_to_sheet(wsData);
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
const originalXlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

const procXlsx = await DocumentProcessor.anonymize(originalXlsxBuffer, 'xlsx', detectionEngine);
assert.strictEqual(procXlsx.isBinaryOut, true, 'XLSX anonymize should flag output as binary');
const anonymizedXlsxBuffer = Buffer.from(procXlsx.anonymizedContent, 'base64');
const anonWb = XLSX.read(anonymizedXlsxBuffer, { type: 'buffer' });
const anonSheet = anonWb.Sheets["Sheet1"];

assert.strictEqual(anonSheet["A2"].v, "[Nombre_001]", "First row name cell replaced");
assert.strictEqual(anonSheet["B2"].v, "[Empresa_001]", "First row company cell replaced");
assert.strictEqual(anonSheet["C2"].v, "[DNI_001]", "First row DNI cell replaced");
assert.strictEqual(anonSheet["A3"].v, "[Nombre_001]", "Second row name cell consistently replaced");

const restoredXlsxBase64 = DocumentProcessor.deanonymize(procXlsx.anonymizedContent, 'xlsx', procXlsx.mapping);
const restoredWb = XLSX.read(Buffer.from(restoredXlsxBase64, 'base64'), { type: 'buffer' });
const restoredSheet = restoredWb.Sheets["Sheet1"];

assert.strictEqual(restoredSheet["A2"].v, "Juan Pérez", "First row name cell restored");
assert.strictEqual(restoredSheet["B2"].v, "ACME", "First row company cell restored");
assert.strictEqual(restoredSheet["C2"].v, "12345678Z", "First row DNI cell restored");
assert.strictEqual(restoredSheet["A3"].v, "Juan Pérez", "Second row name cell consistently restored");
console.log('✅ In-memory XLSX anonymization and de-anonymization verified successfully!');

// ==========================================
// TEST 7: New Entities (Fax, Diligencias, Telefono) & Complex Names (B GERDA HEIDER GREÏNER)
// ==========================================
console.log('\n🏃 Test 7: Testing complex name scans (B GERDA HEIDER GREÏNER) and new entities (fax, diligencias, telefono)...');
const complexText = 'D. B GERDA HEIDER GREÏNER nos envió un fax al Fax: 913334455 y el juzgado abrió el caso de Diligencias Previas 567/2026. Su teléfono móvil es +34 600112233. Además, Telèfon 972 32 42 11 | Fax 972 82 18 59 y Diligències número: 166098/2026.';
const detectedComplex = detectionEngine.detect(complexText);

const complexIds = detectedComplex.map(d => d.id);
assert.ok(complexIds.includes('nombre'), 'Should detect name from dictionary including uppercase, initials and diacritics');
const complexNameMatch = detectedComplex.find(d => d.id === 'nombre');
assert.strictEqual(complexNameMatch.text, 'B GERDA HEIDER GREÏNER', 'Should detect full complex name as a single token');

// Assert Faxes
const faxMatches = detectedComplex.filter(d => d.id === 'fax');
assert.strictEqual(faxMatches.length, 2, 'Should detect two Fax numbers');
assert.ok(faxMatches.some(f => f.text.includes('913334455')), 'Should match first fax');
assert.ok(faxMatches.some(f => f.text.includes('972 82 18 59')), 'Should match Catalan fax');

// Assert Diligencias
const dilMatches = detectedComplex.filter(d => d.id === 'diligencias');
assert.strictEqual(dilMatches.length, 2, 'Should detect two Diligencias numbers');
assert.ok(dilMatches.some(d => d.text.includes('567/2026')), 'Should match standard diligencias');
assert.ok(dilMatches.some(d => d.text.includes('166098/2026')), 'Should match Catalan Diligències with colon');

// Assert Telephones
const telMatches = detectedComplex.filter(d => d.id === 'telefono');
assert.strictEqual(telMatches.length, 2, 'Should detect two telephone numbers');
assert.ok(telMatches.some(t => t.text.includes('600112233')), 'Should match standard mobile');
assert.ok(telMatches.some(t => t.text.includes('972 32 42 11')), 'Should match Catalan double-digit telephone');

// Verify placeholder replacement and de-anonymization consistency
const procComplex = await DocumentProcessor.anonymize(complexText, 'txt', detectionEngine);
assert.ok(procComplex.anonymizedContent.includes('[Nombre_001]'), 'Complex name should be anonymized to single placeholder');
assert.ok(procComplex.anonymizedContent.includes('[Fax_001]'), 'First Fax should be anonymized');
assert.ok(procComplex.anonymizedContent.includes('[Fax_002]'), 'Second Fax should be anonymized');
assert.ok(procComplex.anonymizedContent.includes('[Diligencias_001]'), 'First Diligencias should be anonymized');
assert.ok(procComplex.anonymizedContent.includes('[Diligencias_002]'), 'Second Diligencias should be anonymized');
assert.ok(procComplex.anonymizedContent.includes('[Telefono_001]'), 'First Telefono should be anonymized');
assert.ok(procComplex.anonymizedContent.includes('[Telefono_002]'), 'Second Telefono should be anonymized');

const restoredComplexText = DocumentProcessor.deanonymize(procComplex.anonymizedContent, 'txt', procComplex.mapping);
assert.strictEqual(restoredComplexText, complexText, 'Restored text must match original complex text exactly');
console.log('✅ Complex name detection and new Catalan entities verification passed successfully!');

console.log('\n===========================================================');
console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! (7/7)');
console.log('===========================================================');
process.exit(0);
