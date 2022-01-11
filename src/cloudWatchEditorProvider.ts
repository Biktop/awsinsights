import vscode from 'vscode';
import { readFileSync } from 'fs';
import Handlebars from 'handlebars';
import { CloudWatchClient } from './cloudWatchClient';
import { CloudWatchController, InsightsQuery } from './cloudWatchController';
import { runAction } from './utils';

export class CloudWatchEditorProvider implements vscode.CustomTextEditorProvider {
	public static extension = 'awsinsights';
	private static configurationProfile = 'aws.profile';

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
		this.client = new CloudWatchClient(async () => {
			const configuration = vscode.workspace.getConfiguration(CloudWatchEditorProvider.extension);
			let profile = configuration.get(CloudWatchEditorProvider.configurationProfile);
			if (!profile) {
				profile = await this.chooseProfile();
			}
			return profile;
		});

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
	 * Display all available profiles and allow to select one.
	 */
	public async handleSelectProfile() {
		this.client.disposeClient();
		await this.chooseProfile();
	}

	/**
	 * Create new document and initialze with defaut query.
	 */
	public async handleCreateQuery() {
		await runAction(async () => {
			const logGroupNames = await this.pickLogGroups();		
			if (!logGroupNames.length) { return }

			const content: InsightsQuery = {
				logGroupNames: logGroupNames, relativeTime: 'PT15M',
				queryString: 'fields @timestamp, @message\n | sort @timestamp desc',
			};

			const document = await vscode.workspace.openTextDocument({
				language: CloudWatchController.language, 
				content: JSON.stringify(content, null, 2),
			});
			await vscode.commands.executeCommand('vscode.openWith', document.uri, CloudWatchController.viewType);
		}, { title: 'Select group name…'});
	}
	
	/**
	 * Display picker with all available log groups.
	 */
	private async pickLogGroups(): Promise<Array<string>> {
		const logGroupsNames = await this.client.describeLogGroups();
		const items = await vscode.window.showQuickPick(logGroupsNames.map(label => ({ label })), {
			title: 'test',
			canPickMany: true,
		});
		return items?.map(({ label }) => label) ?? [];
	}

	/**
	 * Display picker with all available aws profiles.
	 */
	private async chooseProfile(): Promise<string | undefined> {
		const profiles = await this.client.getProfiles();
		if (!profiles.length) { return vscode.window.showErrorMessage('Failed to find valid profiles') }
		
		const profile = await vscode.window.showQuickPick(profiles.map(label => ({ label })), {
			title: `Select an AWS credential profile (1/${profiles.length})`,
			placeHolder: 'Select a credential profile',
		});

		if (profile) {
			const configuration = vscode.workspace.getConfiguration(CloudWatchEditorProvider.extension);
			await configuration.update(CloudWatchEditorProvider.configurationProfile, profile.label);
		}
		return profile?.label
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