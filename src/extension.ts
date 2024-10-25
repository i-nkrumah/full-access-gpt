// src/extension.ts
import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';

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

  context.subscriptions.push(generateDisposable, modifyDisposable);
}

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
  let selectedText = '';

  if (choice === 'Current File') {
    const filePath = document.fileName;
    const fileContent = document.getText();
    prompt = `${action} for the following file:\n\nFile Path: ${filePath}\n\n${fileContent}`;
  } else {
    // Read all files in the workspace
    const files = await getAllFiles(workspaceFolders[0].uri.fsPath);
    let combinedContent = '';
    for (const file of files) {
      const ext = path.extname(file);
      const allowedExtensions = ['.js', '.ts', '.py', '.java', '.c', '.cpp', '.cs', '.rb', '.go', '.php'];
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
    // Make the API request with the defined response type
    const response = await axios.post<GPTResponse>('http://localhost:3001/api/generate', { prompt });

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
