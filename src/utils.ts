import vscode from 'vscode';

export async function runAction(action: Function, options?: any) {
	const defs = { cancellable: false, location: vscode.ProgressLocation.Window, title: 'Loading…', ...options };
	try {
		return await vscode.window.withProgress(defs, async () => await action());
	}
	catch (error: any) {
		console.error(error.message);
		vscode.window.showErrorMessage(error.message);

		if (options.throwable) {
			throw error;
		}
	}
}

export async function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
