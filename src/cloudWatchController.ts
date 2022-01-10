import moment from 'moment';
import vscode from 'vscode';
import { StartQueryCommandInput } from '@aws-sdk/client-cloudwatch-logs';
import { CloudWatchClient } from './cloudWatchClient';
import { runAction, wait } from './utils';

export interface InsightsQuery {
	relativeTime?: string

	logGroupName?: string;
	logGroupNames?: string[];

	startTime?: number;
	endTime?: number;

	queryString: string | undefined;
	
	limit?: number;
}

export class CloudWatchController {
	public static readonly viewType = 'awsinsights.insights';
	public static readonly language = 'insights';

	public static async activate(context: vscode.ExtensionContext, client: CloudWatchClient, document: vscode.TextDocument,		
		webviewPanel: vscode.WebviewPanel) {

		const controller = new CloudWatchController(context, client, document, webviewPanel);
		await controller.handleUpdateDocument();
	}

	constructor(
		private context: vscode.ExtensionContext,
		private client: CloudWatchClient,
		private document: vscode.TextDocument,
		private webviewPanel: vscode.WebviewPanel) {

		const receiveMessageSubscription = webviewPanel.webview.onDidReceiveMessage(e => this.handleReceiveMessage(e));
		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {			
			if (e.document.uri.toString() === document.uri.toString()) { this.handleUpdateDocument() }
		});

		webviewPanel.onDidDispose(() => {
			changeDocumentSubscription.dispose();
			receiveMessageSubscription.dispose();
		});
	}

	/**
	 * Exceute query.
	 */
	private async handleStartQuery() {
		await runAction(async () => {
			// await this.postMessage({ type: 'result', payload: sample });

			const query = this.startQueryRequest;
			const queryId = await this.client.startQuery(query);

			while (true) {
				await wait(1000);

				const payload = await this.client.queryResults(queryId);
				await this.postMessage({ type: 'result', payload });

				if (payload.status !== 'Running') { break }
			}		
		}, { title: 'Retrieve records…'});
	}

	private async handleExpandRecord(message: any) {
		await runAction(async () => {
			const record = await this.client.getLogRecord(message.payload.id);
			this.postMessage({ type: 'expand_result', payload: { id: message.payload.id, record }});
		}, { title: 'Retrieve log record…' });
	}

	private async handleOpenRequest(message: any) {
		const timestamp = moment.unix(+message.payload.timestamp / 1000);
		const { logGroupName,  logGroupNames } = this.insightsQuery;

		const content: InsightsQuery = {
			logGroupName, logGroupNames,
			startTime: moment(timestamp).subtract(15, 'minutes').unix(),
			endTime: moment(timestamp).add(15, 'minutes').unix(),
			queryString: `fields @timestamp, @message | sort @timestamp desc | filter @requestId = '${message.payload.id}'`,
		}

		const document = await vscode.workspace.openTextDocument({
			language: CloudWatchController.language, 
			content: JSON.stringify(content, null, 2),
		});
		await vscode.commands.executeCommand('vscode.openWith', document.uri, CloudWatchController.viewType);
	}

	private async handleUpdateQuery(message: any) {
		const content = JSON.stringify(message.payload, null, 2);

		const edit = new vscode.WorkspaceEdit();
		edit.replace(this.document!.uri, new vscode.Range(0, 0, this.document!.lineCount, 0), content);
		await vscode.workspace.applyEdit(edit);
	}

	/**
	 * Post messsage to client script.
	 */
	private async postMessage(data: any) {		
		this.webviewPanel?.webview.postMessage(data);
	}

	private async handleUpdateDocument() {
		await this.postMessage({ type: 'query', payload: this.insightsQuery })
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
	private get insightsQuery(): InsightsQuery  {
		try {
			const content = this.document?.getText() ?? '{}';
			return JSON.parse(content);
		}
		catch (error: any) {
			throw new Error(`Failed to parse insights filter: ${error.message}`)
		}
	}

	private get startQueryRequest(): StartQueryCommandInput  {
		const insightsFilter = this.insightsQuery;

		if (insightsFilter.relativeTime) {
			const duration = moment.duration(insightsFilter.relativeTime);
			if (!duration.isValid()) { throw new Error(`Failed to parse relativeTime: ${insightsFilter.relativeTime}`) }

			const now = moment();
			insightsFilter.endTime = now.unix();
			insightsFilter.startTime = now.subtract(duration).unix();
		}

		return {
			logGroupName: insightsFilter.logGroupName, logGroupNames: insightsFilter.logGroupNames,
			startTime: insightsFilter.startTime, endTime: insightsFilter.endTime,
			queryString: insightsFilter.queryString, limit: insightsFilter.limit,
		};
	}
}

const sample = {"status":"Complete","statistics":{"bytesScanned":4789209,"recordsMatched":22380,"recordsScanned":23234},"results":[{"id":"CmYKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQBhI1GhgCBfmhYB0AAAARPIP+5QAGHaUvEAAAANIgASjky8/m4y8wgKrU5uMvOEhAk2pI5j1QjjIQIhgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.962"},{"field":"@message","value":"REPORT RequestId: f659a3f9-a2b7-43ee-87d9-c451efd20a74\tDuration: 18781.26 ms\tBilled Duration: 18782 ms\tMemory Size: 1536 MB\tMax Memory Used: 130 MB\t\n"}]},{"id":"CmYKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQBhI1GhgCBfmhYB0AAAARPIP+5QAGHaUvEAAAANIgASjky8/m4y8wgKrU5uMvOEhAk2pI5j1QjjIQIRgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.962"},{"field":"@message","value":"END RequestId: f659a3f9-a2b7-43ee-87d9-c451efd20a74\n"}]},{"id":"CmYKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQBhI1GhgCBfmhYB0AAAARPIP+5QAGHaUvEAAAANIgASjky8/m4y8wgKrU5uMvOEhAk2pI5j1QjjIQIBgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.953"},{"field":"@message","value":"2022-01-09T03:13:56.953Z\tf659a3f9-a2b7-43ee-87d9-c451efd20a74\tINFO\tDEBUG Request: stats { totalRequests: 32, throttleRequests: 0, errorRequests: 0 }\n"}]},{"id":"CmgKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQAxI3GhgCBf5GAwsAAAABMCyqDwAGHaUpYAAAALIgASiOq8rm4y8w37zR5uMvOIwBQJ/HAUiDaFDjUhCCARgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.794"},{"field":"@message","value":"2022-01-09T03:13:56.794Z\tbeece3d1-0269-4021-b602-a287445a623c\tINFO\tDEBUG patchWorksheetData: patching 5409 rows from A2:M5410\n"}]},{"id":"CmgKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQAxI3GhgCBf5GAwsAAAABMCyqDwAGHaUpYAAAALIgASiOq8rm4y8w37zR5uMvOIwBQJ/HAUiDaFDjUhCBARgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.793"},{"field":"@message","value":"2022-01-09T03:13:56.793Z\tbeece3d1-0269-4021-b602-a287445a623c\tINFO\tDEBUG updateFlowstepData: batch size: 1048698 { batchSize: 1048698, columns: 13, rows: 5409 }\n"}]},{"id":"CmYKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQBhI1GhgCBfmhYB0AAAARPIP+5QAGHaUvEAAAANIgASjky8/m4y8wgKrU5uMvOEhAk2pI5j1QjjIQHhgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.754"},{"field":"@message","value":"2022-01-09T03:13:56.753Z\tf659a3f9-a2b7-43ee-87d9-c451efd20a74\tINFO\tDEBUG Synchronization is completed\n"}]},{"id":"CmYKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQBhI1GhgCBfmhYB0AAAARPIP+5QAGHaUvEAAAANIgASjky8/m4y8wgKrU5uMvOEhAk2pI5j1QjjIQHxgB","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.754"},{"field":"@message","value":"2022-01-09T03:13:56.754Z\tf659a3f9-a2b7-43ee-87d9-c451efd20a74\tINFO\tDEBUG Close session and return origin calculation mode 'Automatic'\n"}]},{"id":"CmcKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQABI2GhgCBgyXu0sAAAAFUIzJegAGHaUugAAAA7IgASj6hs/m4y8w9aLU5uMvOF5Ay5UBSNVSUJxDEDIYAQ==","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.706"},{"field":"@message","value":"2022-01-09T03:13:56.705Z\t2a4c67fd-2ea2-47dc-9197-fa1fdec80ff9\tINFO\tDEBUG updateFlowstepData: batch size: 2751 { batchSize: 2751, columns: 20, rows: 16 }\n"}]},{"id":"CmcKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQABI2GhgCBgyXu0sAAAAFUIzJegAGHaUugAAAA7IgASj6hs/m4y8w9aLU5uMvOF5Ay5UBSNVSUJxDEDMYAQ==","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.706"},{"field":"@message","value":"2022-01-09T03:13:56.706Z\t2a4c67fd-2ea2-47dc-9197-fa1fdec80ff9\tINFO\tDEBUG patchWorksheetData: patching 16 rows from A8:T23\n"}]},{"id":"CmgKLQopMzI4NTI2NjE1MjYxOi9hd3MvbGFtYmRhL3NhbGVzZm9yY2UtYXN5bmMQARI3GhgCBhuIlV4AAAAAYl5v2QAGHaUuQAAABOIgASjbh8/m4y8w8bXV5uMvOGpAn5gCSLiCAVDkbxBGGAE=","fields":[{"field":"@timestamp","value":"2022-01-09 03:13:56.585"},{"field":"@message","value":"2022-01-09T03:13:56.584Z\t3b9b6aa9-140c-4ab1-8fa4-6d3fcddd0a79\tINFO\tWARN patchWorksheetData: split chunk in two parts and try again\n"}]}]};