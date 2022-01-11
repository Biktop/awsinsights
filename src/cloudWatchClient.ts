import { parseKnownFiles, getMasterProfileName } from '@aws-sdk/util-credentials';
import { fromIni, fromProcess } from '@aws-sdk/credential-providers';
import { CloudWatchLogsClient, CloudWatchLogsClientConfig } from '@aws-sdk/client-cloudwatch-logs';
import { StartQueryCommandInput, StartQueryCommand, DescribeLogGroupsCommand, GetQueryResultsCommand, GetLogRecordCommand } from '@aws-sdk/client-cloudwatch-logs';
import { runAction } from './utils';

export class CloudWatchClient {
  private client: CloudWatchLogsClient | undefined;

  constructor(private readonly resolver: Function) { }

  public disposeClient() {
    this.client = undefined;
  }

  /**
   * Returns all available AWS profiles.
   */
  public async getProfiles(): Promise<Array<string>> {
    const profiles = await parseKnownFiles({});
    return Object.keys(profiles).filter(key => isValidProfile(profiles[key]));
  }

  /**
   * Returns all available log groups.
   */
  public async describeLogGroups(): Promise<string[]> {
    const client = await this.resolveClient();

    const { logGroups = [], nextToken } = await client.send(new DescribeLogGroupsCommand({}));
    return logGroups.map(item => item.logGroupName ?? '');
  }

  /**
   * Start cloudwatch insights query.
   */
  public async startQuery(query: StartQueryCommandInput): Promise<string> {
    const client = await this.resolveClient();

    const { queryId } = await client.send(new StartQueryCommand(query));
    return queryId!;
  }

  /**
   * Retrive cloudwatch log.
   */
  public async queryResults(queryId: string): Promise<any> {
    const client = await this.resolveClient();

    const { status, statistics, results = [] } = await client.send(new GetQueryResultsCommand({ queryId }));
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
    const client = await this.resolveClient();

    const { logRecord } = await client.send(new GetLogRecordCommand({ logRecordPointer }));
    return logRecord;
  }

  /**
   * Initialize and return cloudwatchlogs client.
   */
  private async resolveClient(): Promise<CloudWatchLogsClient> {
    if (!this.client) {
      const configuration = await runAction(async () => await createConfiguration(await this.resolver()), { throwable: true });
      this.client = new CloudWatchLogsClient(configuration);
    }
    return this.client;
  }
}

async function createConfiguration(profile: string): Promise<CloudWatchLogsClientConfig> {
  const profiles = await parseKnownFiles({ profile });
  
  const data = profiles[profile] ?? {};
  const region = data.region ?? 'us-east-1';

  if (data[SHARED_CREDENTIAL_PROPERTIES.CREDENTIAL_PROCESS]) {
    const credentials = await fromProcess({ profile })();
    return { credentials, region };
  }

  throw new Error(`Invalied profile: ${profile}`)
}

function isValidProfile(data: any = {}): Boolean {
  return !!data[SHARED_CREDENTIAL_PROPERTIES.CREDENTIAL_PROCESS];
}

const SHARED_CREDENTIAL_PROPERTIES = {
  AWS_ACCESS_KEY_ID: 'aws_access_key_id',
  AWS_SECRET_ACCESS_KEY: 'aws_secret_access_key',
  AWS_SESSION_TOKEN: 'aws_session_token',
  CREDENTIAL_PROCESS: 'credential_process',
  CREDENTIAL_SOURCE: 'credential_source',
  REGION: 'region',
  ROLE_ARN: 'role_arn',
  SOURCE_PROFILE: 'source_profile',
  MFA_SERIAL: 'mfa_serial',
  SSO_START_URL: 'sso_start_url',
  SSO_REGION: 'sso_region',
  SSO_ACCOUNT_ID: 'sso_account_id',
  SSO_ROLE_NAME: 'sso_role_name',
}