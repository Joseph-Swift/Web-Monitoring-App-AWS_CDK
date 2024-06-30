const https = require('https');
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const cloudwatch = new CloudWatchClient();
const dynamodbClient = new DynamoDBClient();
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const tableName = process.env.DYNAMODB_TABLE_NAME;

exports.handler = async () => {
  const urls = process.env.URLS.split(',');

  console.log('Starting URL checks...');
  
  // Run the check multiple times to simulate 10-second intervals within a single invocation
  for (let i = 0; i < 6; i++) {  // 6 * 10 seconds = 1 minute
    console.log(`Iteration ${i + 1} of 6`);
    const results = await Promise.all(urls.map(url => checkUrl(url.trim())));
    for (const result of results) {
      try {
        await publishMetrics(result);
        console.log(`Metrics published for ${result.url}`);
      } catch (err) {
        console.error(`Error publishing metrics for ${result.url}:`, err);
      }
      
      try {
        await saveToDynamoDB(result);
        console.log(`Data saved to DynamoDB for ${result.url}`);
      } catch (err) {
        console.error(`Error saving data to DynamoDB for ${result.url}:`, err);
      }
    }
    // Wait for 10 seconds before the next run
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  console.log('URL checks completed.');
};

const checkUrl = (url) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    https.get(url, (res) => {
      const latency = Date.now() - startTime;
      const isSuccess = res.statusCode === 200;
      console.log(`Checked ${url}: latency=${latency}ms, success=${isSuccess}`);
      resolve({ url, latency, isSuccess });
    }).on('error', (err) => {
      const latency = Date.now() - startTime;
      console.error(`Error checking ${url}:`, err);
      resolve({ url, latency, isSuccess: false });
    });
  });
};

const publishMetrics = async (result) => {
  const namespace = 'WebMonitoring';
  const timestamp = new Date();
  const params = {
    MetricData: [
      {
        MetricName: 'Latency',
        Dimensions: [
          {
            Name: 'URL',
            Value: result.url,
          },
        ],
        Timestamp: timestamp,
        Unit: 'Milliseconds',
        Value: result.latency,
      },
      {
        MetricName: 'Availability',
        Dimensions: [
          {
            Name: 'URL',
            Value: result.url,
          },
        ],
        Timestamp: timestamp,
        Unit: 'Percent',
        Value: result.isSuccess ? 100 : 0,
      },
    ],
    Namespace: namespace,
  };

  try {
    const command = new PutMetricDataCommand(params);
    await cloudwatch.send(command);
    console.log(`Successfully published metrics to CloudWatch for ${result.url}`);
  } catch (error) {
    console.error(`Failed to publish metrics to CloudWatch for ${result.url}:`, error);
    throw error;
  }
};

const saveToDynamoDB = async (result) => {
  const params = {
    TableName: tableName,
    Item: {
      AlarmName: result.isSuccess ? 'Availability' : 'Latency',
      Timestamp: new Date().toISOString(),
      URL: result.url,
      Latency: result.latency,
      Success: result.isSuccess,
    },
  };

  try {
    const command = new PutCommand(params);
    await dynamodb.send(command);
    console.log(`Successfully saved data to DynamoDB for ${result.url}`);
  } catch (error) {
    console.error(`Failed to save data to DynamoDB for ${result.url}:`, error);
    throw error;
  }
};