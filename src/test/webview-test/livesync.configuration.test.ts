import * as vscode from 'vscode';
import * as assert from 'assert';

suite('LiveSync Configuration Command Tests', () => {
    vscode.window.showInformationMessage('Start LiveSync configuration command tests.');

    suiteSetup(async function() {
        this.timeout(8000);
        // open a sample web view
        
        console.log("suiteSetup");

    });

    test('TestConnection & Save Button', async () => {
        

        // now we can use findWebElement to look for elements inside the webview

        console.log("test");

        // it('Look for all elements with given locator', async () => {
        //     // analogically, findWebElements to search for all occurences
        //     const elements = await view.findWebElements(By.css('h1'));
        //     chai.expect(elements.length).equals(1);
        // });
    });

    suiteTeardown(async () => {
        // after we are done with the webview, switch webdriver back to the vscode window

        console.log("suiteTeardown");
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