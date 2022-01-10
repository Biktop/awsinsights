import * as vscode from 'vscode';

export async function runAction(action: Function, options?: any) {
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

export async function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
