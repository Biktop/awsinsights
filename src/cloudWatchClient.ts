import { parseKnownFiles, getMasterProfileName } from '@aws-sdk/util-credentials';
import { fromIni, fromProcess } from '@aws-sdk/credential-providers';
import { CloudWatchLogsClient, StartQueryCommandInput, StartQueryCommand, DescribeLogGroupsCommand, GetQueryResultsCommand, GetLogRecordCommand } from '@aws-sdk/client-cloudwatch-logs';

export class CloudWatchClient {
  private client: CloudWatchLogsClient;

  constructor() {
    this.client = new CloudWatchLogsClient({ credentials: fromProcess({ profile: 'prod-xappex-api' }), region: 'us-west-2' });
  }

  /**
   * Returns all available log groups.
   */
  public async describeLogGroups(): Promise<string[]> {
    const { logGroups = [], nextToken } = await this.client.send(new DescribeLogGroupsCommand({}));
    return logGroups.map(item => item.logGroupName ?? '');
  }

  /**
   * Start cloudwatch insights query.
   */
  public async startQuery(query: StartQueryCommandInput): Promise<string> {
    const { queryId } = await this.client.send(new StartQueryCommand(query));
    return queryId!;
  }

  /**
   * Retrive cloudwatch log.
   */
  public async queryResults(queryId: string): Promise<any> {
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
  public async getLogRecord(logRecordPointer: string): Promise<any> {
    const { logRecord } = await this.client.send(new GetLogRecordCommand({ logRecordPointer }));
    return logRecord;
  }
}