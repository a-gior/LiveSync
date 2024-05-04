import * as vscode from 'vscode';
import * as assert from 'assert';

suite('LiveSync Configuration Command Tests', () => {
    vscode.window.showInformationMessage('Start LiveSync configuration command tests.');

    suiteSetup(async function() {
        console.log("suiteSetup");

    });

    test('TestConnection & Save Button', async () => {

        console.log("test");

    });

    suiteTeardown(async () => {

        console.log("suiteTeardown");
    });
});