import vscode from 'vscode';
import { CloudWatchEditorProvider } from './cloudWatchEditorProvider';

export function activate(context: vscode.ExtensionContext) {
	const provider = new CloudWatchEditorProvider(context);

	context.subscriptions.push(provider.register());
	context.subscriptions.push(vscode.commands.registerCommand('awsinsights.create', () => provider.executeCreate()));
}

export function deactivate() {}
