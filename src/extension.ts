import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';
import * as fs from 'fs';

// Define the interface for the API response
interface GPTResponse {
    reply: string;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Full Access GPT extension is now active!');

  // Command to Generate Code
  let generateDisposable = vscode.commands.registerCommand('full-access-gpt.generate', async () => {
    await handleGPTRequest('Generate Code');
  });

  // Command to Modify Code
  let modifyDisposable = vscode.commands.registerCommand('full-access-gpt.modify', async () => {
    await handleGPTRequest('Modify Code');
  });

  // Command to Open Webview UI
  let openUIPanel = vscode.commands.registerCommand('full-access-gpt.openUI', () => {
    FullAccessGPTPanel.createOrShow(context.extensionUri);
  });

  context.subscriptions.push(generateDisposable, modifyDisposable, openUIPanel);
}

class FullAccessGPTPanel {
  public static currentPanel: FullAccessGPTPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (FullAccessGPTPanel.currentPanel) {
      FullAccessGPTPanel.currentPanel._panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      'fullAccessGPTUI',
      'Full Access GPT',
      column || vscode.ViewColumn.One,
      {
        // Enable javascript in the webview
        enableScripts: true,

        // Restrict the webview to only load resources from within the extension's `media` directory.
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
      }
    );

    FullAccessGPTPanel.currentPanel = new FullAccessGPTPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.type) {
          case 'submit':
            this.handleSubmit(message.instruction);
            return;
        }
      },
      null,
      this._disposables
    );
  }

  public dispose() {
    FullAccessGPTPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async handleSubmit(instruction: string) {
    // Show a loading indicator in the webview
    this._panel.webview.postMessage({ type: 'status', status: 'Processing...' });

    try {
      // Access API Server URL from configuration
      const config = vscode.workspace.getConfiguration('full-access-gpt');
      const apiServerUrl = config.get<string>('apiServerUrl') || 'http://localhost:3001/api/generate';

      // Make the API request with the defined response type
      const response = await axios.post<GPTResponse>(apiServerUrl, { prompt: instruction });

      if (response.data && response.data.reply) {
        const reply = response.data.reply;
        // Send the reply back to the webview
        this._panel.webview.postMessage({ type: 'response', reply: reply });
      } else {
        this._panel.webview.postMessage({ type: 'response', reply: 'No response from GPT-4.' });
      }
    } catch (error) {
      console.error('Error:', error);
      this._panel.webview.postMessage({ type: 'response', reply: 'Failed to generate response from GPT-4.' });
    }
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview() {
    const nonce = getNonce();
    const webviewPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'webview.html');

    let htmlContent = fs.readFileSync(webviewPath.fsPath, 'utf8');

    // Replace the nonce placeholder with the actual nonce
    htmlContent = htmlContent.replace(/PLACEHOLDER_NONCE/g, nonce);

    return htmlContent;
  }
}

// Helper function to generate a nonce
function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// Existing handleGPTRequest function
async function handleGPTRequest(action: string) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor found.');
    return;
  }

  const document = editor.document;
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder is open.');
    return;
  }

  // Option to choose between entire workspace or current file
  const choice = await vscode.window.showQuickPick(['Current File', 'Entire Workspace'], {
    placeHolder: 'Select the scope for the action',
  });

  if (!choice) {
    return;
  }

  let prompt = '';

  if (choice === 'Current File') {
    const filePath = document.fileName;
    const fileContent = document.getText();
    prompt = `${action} for the following file:\n\nFile Path: ${filePath}\n\n${fileContent}`;
  } else {
    // Read all files in the workspace
    const files = await getAllFiles(workspaceFolders[0].uri.fsPath);
    let combinedContent = '';
    const config = vscode.workspace.getConfiguration('full-access-gpt');
    const allowedExtensions: string[] = config.get<string[]>('allowedFileTypes') || [
      ".js",
      ".ts",
      ".py",
      ".java",
      ".c",
      ".cpp",
      ".cs",
      ".rb",
      ".go",
      ".php"
    ];

    for (const file of files) {
      const ext = path.extname(file);
      if (allowedExtensions.includes(ext)) {
        try {
          const content = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
          combinedContent += `\n\n// File: ${file}\n${Buffer.from(content).toString('utf8')}`;
        } catch (err) {
          console.error(`Failed to read file ${file}:`, err);
        }
      }
    }
    prompt = `${action} for the entire workspace:\n\n${combinedContent}`;
  }

  // Prompt the user for additional instructions if needed
  const additionalInstructions = await vscode.window.showInputBox({
    prompt: 'Enter any additional instructions or context (optional)',
  });

  if (additionalInstructions) {
    prompt += `\n\nAdditional Instructions: ${additionalInstructions}`;
  }

  // Show a loading indicator
  const loading = vscode.window.setStatusBarMessage('$(sync~spin) Processing GPT-4 request...', 10000);

  try {
    // Access API Server URL from configuration
    const config = vscode.workspace.getConfiguration('full-access-gpt');
    const apiServerUrl = config.get<string>('apiServerUrl') || 'http://localhost:3001/api/generate';

    // Make the API request with the defined response type
    const response = await axios.post<GPTResponse>(apiServerUrl, { prompt });

    if (response.data && response.data.reply) {
      const reply = response.data.reply;

      if (choice === 'Current File') {
        // Insert the reply below the selected text
        editor.edit(editBuilder => {
          const end = editor.selection.end;
          editBuilder.insert(end, `\n\n// GPT-4 Response:\n${reply}`);
        });
      } else {
        // For entire workspace, create a new file with the response
        const workspacePath = workspaceFolders[0].uri.fsPath;
        const newFilePath = path.join(workspacePath, 'GPT-4_Response.md');

        const newFileUri = vscode.Uri.file(newFilePath);
        const existingFile = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === newFileUri.toString());

        if (existingFile) {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(newFileUri, new vscode.Range(existingFile.lineCount, 0, existingFile.lineCount, 0), `\n\n# GPT-4 Response\n${reply}`);
          await vscode.workspace.applyEdit(edit);
        } else {
          await vscode.workspace.fs.writeFile(newFileUri, Buffer.from(`# GPT-4 Response\n\n${reply}`, 'utf8'));
          await vscode.window.showTextDocument(newFileUri);
        }
      }

      vscode.window.showInformationMessage('GPT-4 response generated successfully!');
    } else {
      vscode.window.showErrorMessage('No response from GPT-4.');
    }
  } catch (error) {
    console.error('Error:', error);
    vscode.window.showErrorMessage('Failed to generate response from GPT-4.');
  } finally {
    loading.dispose();
  }
}

async function getAllFiles(dir: string, fileList: string[] = []): Promise<string[]> {
  const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
  for (const [fileName, fileType] of files) {
    const filePath = path.join(dir, fileName);
    if (fileType === vscode.FileType.Directory) {
      await getAllFiles(filePath, fileList);
    } else if (fileType === vscode.FileType.File) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

export function deactivate() {}
