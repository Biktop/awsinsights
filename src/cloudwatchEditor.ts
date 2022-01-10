import * as moment from 'moment';
import * as vscode from 'vscode';
import { readFileSync } from 'fs';
import * as Handlebars from 'handlebars';
import { parseKnownFiles, getMasterProfileName} from '@aws-sdk/util-credentials';
import { fromIni, fromProcess } from '@aws-sdk/credential-providers';
import { CloudWatchLogsClient, StartQueryCommandInput, StartQueryCommand, DescribeLogGroupsCommand, GetQueryResultsCommand, GetLogRecordCommand } from '@aws-sdk/client-cloudwatch-logs';

interface InsightsQuery extends StartQueryCommandInput {
	relativeTime?: string
}

export class CloudWatchEditorProvider implements vscode.CustomTextEditorProvider {
	public static readonly viewType = 'awsinsights.insights';
	public static readonly language = 'insights';

	private client: CloudWatchLogsClient;

	private document: vscode.TextDocument | null = null;
	private webviewPanel: vscode.WebviewPanel | null = null;

	public register(): vscode.Disposable {
		return vscode.window.registerCustomEditorProvider(CloudWatchEditorProvider.viewType, this, { webviewOptions: { enableFindWidget: true }});
	}

	constructor(private readonly context: vscode.ExtensionContext) {
		this.client = new CloudWatchLogsClient({ credentials: fromProcess({ profile: 'prod-xappex-api' }), region: 'us-west-2' });
	}

	/**
	 * Create new document and initialze with defaut query.
	 */
	public async executeCreate() {
		const logGroupName = await this.pickLogGroup();
		if (!logGroupName) { return }

		const endTime = Math.round((new Date()).getTime() / 1000);
		const content: InsightsQuery = {
			startTime: endTime - 3600, endTime,
			logGroupName,
			queryString: 'fields @timestamp, @message | sort @timestamp desc',
		};

		const document = await vscode.workspace.openTextDocument({
			language: CloudWatchEditorProvider.language, 
			content: JSON.stringify(content, null, 2),
		});
		await vscode.commands.executeCommand('vscode.openWith', document.uri, CloudWatchEditorProvider.viewType);
	}

	/**
	 * Called when our custom editor is opened.
	 */
	public async resolveCustomTextEditor(document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken): Promise<void> {

		this.document = document;
		this.webviewPanel = webviewPanel;

		webviewPanel.webview.options = { enableScripts: true };
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
		await this.handleUpdateDocument();

		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {			
			if (e.document.uri.toString() === document.uri.toString()) {
				this.handleUpdateDocument();
			}
		});

		webviewPanel.onDidDispose(() => {
			this.document = null;
			this.webviewPanel = null;
			changeDocumentSubscription.dispose();
		});

		webviewPanel.webview.onDidReceiveMessage(e => this.handleReceiveMessage(e));
	}

	/**
	 * Display picker with all available log groups.
	 */
	private async pickLogGroup(): Promise<string | undefined> {
		return await runAction(async () => {
			const logGroupsNames = await this.describeLogGroups();
			const item = await vscode.window.showQuickPick(logGroupsNames.map(label => ({ label })));		
			return item?.label;
		}, { title: 'Select group name…'});
	}

	/**
	 * Exceute query.
	 */
	private async handleStartQuery() {
		await runAction(async () => {
			const query = this.getDocumentAsInsightsFilter();

			if (query.relativeTime) {
				const duration = moment.duration(query.relativeTime);
				if (!duration.isValid()) { throw new Error(`Failed to parse relativeTime: ${query.relativeTime}`) }

				const now = moment();
				query.endTime = now.unix();
				query.startTime = now.subtract(duration).unix();
			}


			await this.postMessage({ type: 'result', payload: sample });

		// 	const queryId = await this.startQuery(query);

		// 	while (true) {
		// 		await wait(1000);

		// 		const payload = await this.queryResults(queryId);
		// 		await this.postMessage({ type: 'result', payload });

		// 		if (payload.status !== 'Running') { break }
		// 	}		
		}, { title: 'Retrieve records…'});
	}

	private async handleExpandRecord(message: any) {
		await runAction(async () => {
			const record = await this.getLogRecord(message.payload.id);
			this.postMessage({ type: 'expand_result', payload: { id: message.payload.id, record }});
		}, { title: 'Retrieve log record…' });
	}

	private async handleOpenRequest(message: any) {
		const content: InsightsQuery = {
			...this.getDocumentAsInsightsFilter(),
			limit: undefined,
			queryString: `fields @timestamp, @message | sort @timestamp desc | filter @requestId = '${message.payload.id}'`,
		}
		

		const document = await vscode.workspace.openTextDocument({
			language: CloudWatchEditorProvider.language, 
			content: JSON.stringify(content, null, 2),
		});
		await vscode.commands.executeCommand('vscode.openWith', document.uri, CloudWatchEditorProvider.viewType);
	}

	private async handleUpdateQuery(message: any) {
		const content = JSON.stringify(message.payload, null, 2);

		const edit = new vscode.WorkspaceEdit();
		edit.replace(this.document!.uri, new vscode.Range(0, 0, this.document!.lineCount, 0), content);
		await vscode.workspace.applyEdit(edit);
	}

	/**
	 * Returns all available log groups.
	 */
	private async describeLogGroups(): Promise<string[]> {
		const { logGroups = [], nextToken } = await this.client.send(new DescribeLogGroupsCommand({}));
		return logGroups.map(item => item.logGroupName ?? '');
	}

	/**
	 * Start cloudwatch insights query.
	 */
	private async startQuery(query: StartQueryCommandInput): Promise<string> {
		const { queryId } = await this.client.send(new StartQueryCommand(query));
		return queryId!;
	}

	/**
	 * Retrive cloudwatch log.
	 */
	private async queryResults(queryId: string) {
		const { status, statistics, results = [] } = await this.client.send(new GetQueryResultsCommand({ queryId }));
		return {
			status, statistics,
			results: results.map((items) => {
				const ptr = items.pop();
				return { id: ptr!.value, fields: items };
			})
		};
	}

	/**
	 * Retrive single log record.
	 */
	private async getLogRecord(logRecordPointer: string): Promise<any> {
		const { logRecord } = await this.client.send(new GetLogRecordCommand({ logRecordPointer }));
		return logRecord;
	}

	/**
	 * Get the static html used for the editor webviews.
	 */
	private getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'base.css'));

		const content = readFileSync(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'index.handlebars').fsPath);
		const template = Handlebars.compile(content.toString());

		return template({ scriptUri, styleMainUri });
	}

	/**
	 * Post messsage to client script.
	 */
	private async postMessage(data: any) {		
		this.webviewPanel?.webview.postMessage(data);
	}

	private async handleUpdateDocument() {
		const payload = this.getDocumentAsInsightsFilter();
		await this.postMessage({ type: 'query', payload })
	}

	private handleReceiveMessage(message: any) {
		console.log('Get message from client:', message.type);
		
		const handlers: { [key: string]: Function } = {
			query: this.handleUpdateQuery, execute: this.handleStartQuery,
			expand: this.handleExpandRecord, open_request: this.handleOpenRequest,
		};
		handlers[message.type] && handlers[message.type].call(this, message);
	}

	/**
	 * Try to convert current document to insights query.
	 */
	private getDocumentAsInsightsFilter(): InsightsQuery  {
		try {
			const content = this.document?.getText() ?? '{}';
			return JSON.parse(content);
		}
		catch (error: any) {
			throw new Error(`Failed to parse insights filter: ${error.message}`)
		}
	}
}

async function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAction(action: Function, options?: any) {
	try {
		const defs = {
			cancellable: false,
			location: vscode.ProgressLocation.Window,
			title: 'Loading…',
			...options,
		};
		return await vscode.window.withProgress(defs, async () => await action());
	}
	catch (error: any) {
		console.error(error.message);
		vscode.window.showErrorMessage(error.message);
	}
}

const sample = {"status":"Complete","statistics":{"bytesScanned":4789209,"recordsMatched":22380,"recordsScanned":23234},"results":[{"id":"CmYKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQBhI1GhgCBfmhYB0AAAARPIP+5QAGHaUvEAAAANIgASjky8/m4y8wgKrU5uMvOEhAk2pI5j1QjjIQIhgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.962"},{"field":"@message","value":"REPORT RequestId: f659a3f9-a2b7-43ee-87d9-c451efd20a74\tDuration: 18781.26 ms\tBilled Duration: 18782 ms\tMemory Size: 1536 MB\tMax Memory Used: 130 MB\t\n"}]},{"id":"CmYKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQBhI1GhgCBfmhYB0AAAARPIP+5QAGHaUvEAAAANIgASjky8/m4y8wgKrU5uMvOEhAk2pI5j1QjjIQIRgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.962"},{"field":"@message","value":"END RequestId: f659a3f9-a2b7-43ee-87d9-c451efd20a74\n"}]},{"id":"CmYKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQBhI1GhgCBfmhYB0AAAARPIP+5QAGHaUvEAAAANIgASjky8/m4y8wgKrU5uMvOEhAk2pI5j1QjjIQIBgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.953"},{"field":"@message","value":"2022-01-09T03:13:56.953Z\tf659a3f9-a2b7-43ee-87d9-c451efd20a74\tINFO\tDEBUG Request: stats { totalRequests: 32, throttleRequests: 0, errorRequests: 0 }\n"}]},{"id":"CmgKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQAxI3GhgCBf5GAwsAAAABMCyqDwAGHaUpYAAAALIgASiOq8rm4y8w37zR5uMvOIwBQJ/HAUiDaFDjUhCCARgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.794"},{"field":"@message","value":"2022-01-09T03:13:56.794Z\tbeece3d1-0269-4021-b602-a287445a623c\tINFO\tDEBUG patchWorksheetData: patching 5409 rows from A2:M5410\n"}]},{"id":"CmgKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQAxI3GhgCBf5GAwsAAAABMCyqDwAGHaUpYAAAALIgASiOq8rm4y8w37zR5uMvOIwBQJ/HAUiDaFDjUhCBARgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.793"},{"field":"@message","value":"2022-01-09T03:13:56.793Z\tbeece3d1-0269-4021-b602-a287445a623c\tINFO\tDEBUG updateFlowstepData: batch size: 1048698 { batchSize: 1048698, columns: 13, rows: 5409 }\n"}]},{"id":"CmYKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQBhI1GhgCBfmhYB0AAAARPIP+5QAGHaUvEAAAANIgASjky8/m4y8wgKrU5uMvOEhAk2pI5j1QjjIQHhgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.754"},{"field":"@message","value":"2022-01-09T03:13:56.753Z\tf659a3f9-a2b7-43ee-87d9-c451efd20a74\tINFO\tDEBUG Synchronization is completed\n"}]},{"id":"CmYKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQBhI1GhgCBfmhYB0AAAARPIP+5QAGHaUvEAAAANIgASjky8/m4y8wgKrU5uMvOEhAk2pI5j1QjjIQHxgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.754"},{"field":"@message","value":"2022-01-09T03:13:56.754Z\tf659a3f9-a2b7-43ee-87d9-c451efd20a74\tINFO\tDEBUG Close session and return origin calculation mode 'Automatic'\n"}]},{"id":"CmcKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQABI2GhgCBgyXu0sAAAAFUIzJegAGHaUugAAAA7IgASj6hs/m4y8w9aLU5uMvOF5Ay5UBSNVSUJxDEDIYAQ==","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.706"},{"field":"@message","value":"2022-01-09T03:13:56.705Z\t2a4c67fd-2ea2-47dc-9197-fa1fdec80ff9\tINFO\tDEBUG updateFlowstepData: batch size: 2751 { batchSize: 2751, columns: 20, rows: 16 }\n"}]},{"id":"CmcKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQABI2GhgCBgyXu0sAAAAFUIzJegAGHaUugAAAA7IgASj6hs/m4y8w9aLU5uMvOF5Ay5UBSNVSUJxDEDMYAQ==","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.706"},{"field":"@message","value":"2022-01-09T03:13:56.706Z\t2a4c67fd-2ea2-47dc-9197-fa1fdec80ff9\tINFO\tDEBUG patchWorksheetData: patching 16 rows from A8:T23\n"}]},{"id":"CmgKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQARI3GhgCBhuIlV4AAAAAYl5v2QAGHaUuQAAABOIgASjbh8/m4y8w8bXV5uMvOGpAn5gCSLiCAVDkbxBGGAE=","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.585"},{"field":"@message","value":"2022-01-09T03:13:56.584Z\t3b9b6aa9-140c-4ab1-8fa4-6d3fcddd0a79\tINFO\tWARN patchWorksheetData: split chunk in two parts and try again\n"}]}]};