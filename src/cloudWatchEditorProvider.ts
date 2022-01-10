import * as vscode from 'vscode';
import { readFileSync } from 'fs';
import * as Handlebars from 'handlebars';
import { CloudWatchClient } from './cloudWatchClient';
import { CloudWatchController, InsightsQuery } from './cloudWatchController';
import { runAction } from './utils';

export class CloudWatchEditorProvider implements vscode.CustomTextEditorProvider {
	private client: CloudWatchClient;
	private template: HandlebarsTemplateDelegate;

	public register(): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(CloudWatchController.viewType, this, {
			webviewOptions: {
				enableFindWidget: true,
				// retainContextWhenHidden: true,
			},
		});
	}

	constructor(private readonly context: vscode.ExtensionContext) {
		this.client = new CloudWatchClient();

		const content = readFileSync(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'index.handlebars').fsPath);
		this.template = Handlebars.compile(content.toString());
	}

	/**
	 * Called when our custom editor is opened.
	 */
	public async resolveCustomTextEditor(document: vscode.TextDocument,		
		webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken): Promise<void> {

		console.log('resolveCustomTextEditor');

		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		CloudWatchController.activate(this.context, this.client, document, webviewPanel);
	}

	/**
	 * Create new document and initialze with defaut query.
	 */
	public async executeCreate() {
		const logGroupName = await this.pickLogGroup();
		if (!logGroupName) { return }

		const content: InsightsQuery = {
			logGroupName, relativeTime: 'PT15M',
			queryString: 'fields @timestamp, @message\n | sort @timestamp desc',
		};

		const document = await vscode.workspace.openTextDocument({
			language: CloudWatchController.language, 
			content: JSON.stringify(content, null, 2),
		});
		await vscode.commands.executeCommand('vscode.openWith', document.uri, CloudWatchController.viewType);
	}
	
	/**
	 * Display picker with all available log groups.
	 */
	private async pickLogGroup(): Promise<string | undefined> {
		return await runAction(async () => {
			const logGroupsNames = await this.client.describeLogGroups();
			const item = await vscode.window.showQuickPick(logGroupsNames.map(label => ({ label })));		
			return item?.label;
		}, { title: 'Select group name…'});
	}

	/**
	 * Get the static html used for the editor webviews.
	 */
	private getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'base.css'));
		return this.template({ scriptUri, styleMainUri });
	}
}