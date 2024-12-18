import { TextDocumentItem } from 'vscode-languageserver-protocol';

// Create a test document
const doc: TextDocumentItem = {
    uri: 'file:///test.ts',
    languageId: 'typescript',
    version: 1,
    text: 'const x = 1;'
};

// Try to access properties to test type checking
console.log(doc.uri);
console.log(doc.languageId);
console.log(doc.version);
console.log(doc.text);

// Intentionally try to access non-existent property to test type checking
