// A lot of the code used to make this extension is from the following repos:
// https://github.com/phindle/error-lens/blob/master/src/extension.ts
// https://github.com/microsoft/vscode-extension-samples/tree/main/webview-sample
// https://github.com/microsoft/vscode-extension-samples/tree/main/webview-view-sample
// https://code.visualstudio.com/api/extension-guides/webview
// and more that I can't find anymore

"use strict";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

let forbiddenExtensionsLanguages: { [key: string]: string } = {
  "ts": "TypeScript",
  "lua": "Lua",
  "adoc": "AsciiDoc",
  "js": "JavaScript",
  "vb": "Visual Basic",
  "vba": "Visual Basic",
  "sh": "A shell script"
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log("Extension activated");

  const provider = new CustomSidebarViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      CustomSidebarViewProvider.viewType,
      provider
    )
  );

  let _statusBarItem: vscode.StatusBarItem;
  let errorLensEnabled: boolean = true;

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // console.log('Visual Studio Code Extension "errorlens" is now active');

  // Commands are defined in the package.json file
  let disposableEnableErrorLens = vscode.commands.registerCommand(
    "ErrorLens.enable",
    () => {
      errorLensEnabled = true;

      const activeTextEditor: vscode.TextEditor | undefined =
        vscode.window.activeTextEditor;
      if (activeTextEditor) {
        updateDecorationsForUri(activeTextEditor.document.uri);
      }
    }
  );

  context.subscriptions.push(disposableEnableErrorLens);

  let disposableDisableErrorLens = vscode.commands.registerCommand(
    "ErrorLens.disable",
    () => {
      errorLensEnabled = false;

      const activeTextEditor: vscode.TextEditor | undefined =
        vscode.window.activeTextEditor;
      if (activeTextEditor) {
        updateDecorationsForUri(activeTextEditor.document.uri);
      }
    }
  );

  context.subscriptions.push(disposableDisableErrorLens);

  vscode.languages.onDidChangeDiagnostics(
    (diagnosticChangeEvent) => {
      onChangedDiagnostics(diagnosticChangeEvent);
    },
    null,
    context.subscriptions
  );

  // Note: URIs for onDidOpenTextDocument() can contain schemes other than file:// (such as git://)
  vscode.workspace.onDidOpenTextDocument(
    (textDocument) => {
      updateDecorationsForUri(textDocument.uri);
    },
    null,
    context.subscriptions
  );

  // Update on editor switch.
  vscode.window.onDidChangeActiveTextEditor(
    (textEditor) => {
      if (textEditor === undefined) {
        return;
      }
      updateDecorationsForUri(textEditor.document.uri);
    },
    null,
    context.subscriptions
  );

  function onChangedDiagnostics(
    diagnosticChangeEvent: vscode.DiagnosticChangeEvent
  ) {
    if (!vscode.window) {
      return;
    }

    const activeTextEditor: vscode.TextEditor | undefined =
      vscode.window.activeTextEditor;
    if (!activeTextEditor) {
      return;
    }

    // Many URIs can change - we only need to decorate the active text editor
    for (const uri of diagnosticChangeEvent.uris) {
      // Only update decorations for the active text editor.
      if (uri.fsPath === activeTextEditor.document.uri.fsPath) {
        updateDecorationsForUri(uri);
        break;
      }
    }
  }

  function updateDecorationsForUri(uriToDecorate: vscode.Uri) {
    if (!uriToDecorate) {
      return;
    }

    // Only process "file://" URIs.
    if (uriToDecorate.scheme !== "file") {
      return;
    }

    if (!vscode.window) {
      return;
    }

    const activeTextEditor: vscode.TextEditor | undefined =
      vscode.window.activeTextEditor;
    if (!activeTextEditor) {
      return;
    }

    if (!activeTextEditor.document.uri.fsPath) {
      return;
    }

    let numErrors = 0;
    let numWarnings = 0;

    if (errorLensEnabled) {
      let aggregatedDiagnostics: any = {};
      let diagnostic: vscode.Diagnostic;

      // Iterate over each diagnostic that VS Code has reported for this file. For each one, add to
      // a list of objects, grouping together diagnostics which occur on a single line.
      for (diagnostic of vscode.languages.getDiagnostics(uriToDecorate)) {
        let key = "line" + diagnostic.range.start.line;

        if (aggregatedDiagnostics[key]) {
          // Already added an object for this key, so augment the arrayDiagnostics[] array.
          aggregatedDiagnostics[key].arrayDiagnostics.push(diagnostic);
        } else {
          // Create a new object for this key, specifying the line: and a arrayDiagnostics[] array
          aggregatedDiagnostics[key] = {
            line: diagnostic.range.start.line,
            arrayDiagnostics: [diagnostic],
          };
        }

        switch (diagnostic.severity) {
          case 0:
            numErrors += 1;
            break;

          case 1:
            numWarnings += 1;
            break;

          // Ignore other severities.
        }
      }
    }
  }
}

class CustomSidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "mr-incredible-uncanny.openview";

  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) { }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext<unknown>,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // default webview will show doom face 0
    webviewView.webview.html = this.getHtmlContent(webviewView.webview, 0);

    // This is called every second is decides which doom face to show in the webview

    setInterval(() => {
      let errors = getNumErrors();
      let warnings = getNumWarnings();

      if (errors !== 0) {
        webviewView.webview.html = this.getHtmlContent(webviewView.webview, -errors);
      } else if (isCurrentExtensionForbidden()) {
        webviewView.webview.html = this.getHtmlContent(webviewView.webview, -1);
      }
      else if (warnings < 10) {
        webviewView.webview.html = this.getHtmlContent(webviewView.webview, 11 - warnings);
      } else {
        webviewView.webview.html = this.getHtmlContent(webviewView.webview, 0);
      }
    }, 1000);
  }

  private getHtmlContent(webview: vscode.Webview, doomFace: number): string {
    const stylesheetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "assets", "main.css")
    );

    let face;
    if (doomFace >= 11) {
      face = webview.asWebviewUri(
        vscode.Uri.joinPath(this._extensionUri, "assets", "giga_chad.png")
      );
    } else if (doomFace <= -20) {
      face = webview.asWebviewUri(
        vscode.Uri.joinPath(this._extensionUri, "assets", "phase-20.png"
        )
      );
    }
    else {
      face = webview.asWebviewUri(
        vscode.Uri.joinPath(this._extensionUri, "assets", "phase" + doomFace.toString() + ".png"
        )
      );
    }

    return getHtml(face);
  }
}

function getHtml(doomFace: any) {
  if (isCurrentExtensionForbidden()) {
    return `
    <!DOCTYPE html>
			<html lang="en">
			<head>

			</head>

			<body>
			<section class="wrapper">
      <img class="doomFaces" src="${doomFace}" alt="" >
      <h1 id="errorNum">Error: You</h1>
      <p>Seriously? ${isCurrentExtensionForbidden()}?</p>
			</section>
      </body>

		</html>
  `;
  }
  else {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>

    </head>

    <body>
    <section class="wrapper">
    <img class="doomFaces" src="${doomFace}" alt="" >
    <h1 id="errorNum">${getNumErrors() + " errors"}</h1>
    <h1 id="warningNum">${getNumWarnings() + " warnings"}</h1>
    </section>
    </body>

  </html>
`;
  }
}

function isCurrentExtensionForbidden() {
  let extension = vscode.window.activeTextEditor?.document.fileName.split('.').pop();
  // check if the extension is forbidden in object forbiddenExtensionsLanguages
  if (!extension) {
    return;
  }
  for (let key in forbiddenExtensionsLanguages) {
    if (key.toString() === extension) {
      return forbiddenExtensionsLanguages[key];
    }
  }
}
// function to get the number of errors in the open file
function getNumErrors(): number {
  const activeTextEditor: vscode.TextEditor | undefined =
    vscode.window.activeTextEditor;
  if (!activeTextEditor) {
    return 0;
  }
  const document: vscode.TextDocument = activeTextEditor.document;

  let numErrors = 0;
  let numWarnings = 0;

  let aggregatedDiagnostics: any = {};
  let diagnostic: vscode.Diagnostic;

  // Iterate over each diagnostic that VS Code has reported for this file. For each one, add to
  // a list of objects, grouping together diagnostics which occur on a single line.
  for (diagnostic of vscode.languages.getDiagnostics(document.uri)) {
    let key = "line" + diagnostic.range.start.line;

    if (aggregatedDiagnostics[key]) {
      // Already added an object for this key, so augment the arrayDiagnostics[] array.
      aggregatedDiagnostics[key].arrayDiagnostics.push(diagnostic);
    } else {
      // Create a new object for this key, specifying the line: and a arrayDiagnostics[] array
      aggregatedDiagnostics[key] = {
        line: diagnostic.range.start.line,
        arrayDiagnostics: [diagnostic],
      };
    }

    switch (diagnostic.severity) {
      case 0:
        numErrors += 1;
        break;

      case 1:
        numWarnings += 1;
        break;

      // Ignore other severities.
    }
  }

  return numErrors;
}

function getNumWarnings(): number {
  const activeTextEditor: vscode.TextEditor | undefined =
    vscode.window.activeTextEditor;
  if (!activeTextEditor) {
    return 0;
  }
  const document: vscode.TextDocument = activeTextEditor.document;

  let numErrors = 0;
  let numWarnings = 0;

  let aggregatedDiagnostics: any = {};
  let diagnostic: vscode.Diagnostic;

  // Iterate over each diagnostic that VS Code has reported for this file. For each one, add to
  // a list of objects, grouping together diagnostics which occur on a single line.
  for (diagnostic of vscode.languages.getDiagnostics(document.uri)) {
    let key = "line" + diagnostic.range.start.line;

    if (aggregatedDiagnostics[key]) {
      // Already added an object for this key, so augment the arrayDiagnostics[] array.
      aggregatedDiagnostics[key].arrayDiagnostics.push(diagnostic);
    } else {
      // Create a new object for this key, specifying the line: and a arrayDiagnostics[] array
      aggregatedDiagnostics[key] = {
        line: diagnostic.range.start.line,
        arrayDiagnostics: [diagnostic],
      };
    }

    switch (diagnostic.severity) {
      case 0:
        numErrors += 1;
        break;

      case 1:
        numWarnings += 1;
        break;

      // Ignore other severities.
    }
  }

  return numWarnings;
}

// this method is called when your extension is deactivated
export function deactivate() { }