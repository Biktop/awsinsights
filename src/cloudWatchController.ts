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

	private queryId: string | undefined;

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
			const query = this.startQueryRequest;
			this.queryId = await this.client.startQuery(query);
			await wait(1000);

			while (true) {
				if (!this.queryId) { return await this.postMessage({ type: 'result', status: 'Cancelled' }) }

				const payload = await this.client.queryResults(this.queryId);				
				await this.postMessage({ type: 'result', payload });

				if (payload.status !== 'Running') { break }
				await wait(1000);
			}		
		}, { title: 'Retrieve records…'});
	}

	/**
	 * Stop query.
	 */
	private async handleStopQuery() {
		const queryId = this.queryId;
		this.queryId = undefined;

		queryId && await this.client.stopQuery(queryId!);
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
		await this.updateInsightsQuery(message.payload);
	}

	private async handleSelectGroups(message: any) {		
		await runAction(async () => {
			const query = this.insightsQuery;

			const logGroupNames = await this.client.pickLogGroups(query.logGroupName ? [query.logGroupName] : this.insightsQuery.logGroupNames);
			if (!logGroupNames.length) { return }
			query.logGroupNames = logGroupNames;
			query.logGroupName = undefined;

			this.updateInsightsQuery(query);
			this.postMessage({ type: 'query', payload: query });
		});
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
			execute: this.handleStartQuery, stop: this.handleStopQuery,
			expand: this.handleExpandRecord, open_request: this.handleOpenRequest,
			query: this.handleUpdateQuery, select: this.handleSelectGroups,
		};
		handlers[message.type] && handlers[message.type].call(this, message);
	}

	private async updateInsightsQuery(query: InsightsQuery) {
		const content = JSON.stringify(query, null, 2);

		const edit = new vscode.WorkspaceEdit();
		edit.replace(this.document!.uri, new vscode.Range(0, 0, this.document!.lineCount, 0), content);
		await vscode.workspace.applyEdit(edit);
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
