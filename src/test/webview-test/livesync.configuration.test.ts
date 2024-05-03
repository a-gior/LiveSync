import * as vscode from 'vscode';
import chai from 'chai';
import * as assert from 'assert';
import { Workbench, EditorView, WebView, By } from 'vscode-extension-tester';

suite('LiveSync Configuration Command Tests', () => {
    vscode.window.showInformationMessage('Start LiveSync configuration command tests.');
    let view: WebView;

    suiteSetup(async function() {
        this.timeout(8000);
        // open a sample web view
        await new Workbench().executeCommand('Configuration');
        await new Promise((res) => { setTimeout(res, 500); });
        // init the WebView page object
        view = new WebView();

        console.log(view);

        await view.switchToFrame();
    });

    test('TestConnection & Save Button', async () => {
        

        // now we can use findWebElement to look for elements inside the webview
        const element = await view.findWebElement(By.css('h1'));
        chai.expect(await element.getText()).has.string('This is a web view');

        // it('Look for all elements with given locator', async () => {
        //     // analogically, findWebElements to search for all occurences
        //     const elements = await view.findWebElements(By.css('h1'));
        //     chai.expect(elements.length).equals(1);
        // });
    });

    suiteTeardown(async () => {
        // after we are done with the webview, switch webdriver back to the vscode window
        await view.switchBack();
        await new EditorView().closeAllEditors();
    });

    // test('Save Button', async () => {
    //     // Execute the livesync.configuration command
    //     await vscode.commands.executeCommand('livesync.configuration');

    //     // Simulate user input by populating input fields with mock values
    //     // ...

    //     // Click the "Save" button
    //     // ...

    //     // Assert expected behavior after clicking the button
    //     // ...
    // });
});