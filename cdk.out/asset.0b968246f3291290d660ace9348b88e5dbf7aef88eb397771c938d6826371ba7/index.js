const https = require('https');
const AWS = require('aws-sdk');
const cloudwatch = new AWS.CloudWatch();
const dynamodb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.DYNAMODB_TABLE_NAME;

exports.handler = async () => {
  const urls = process.env.URLS.split(',');
  const results = await Promise.all(urls.map(url => checkUrl(url.trim())));
  for (const result of results) {
    await publishMetrics(result);
    await saveToDynamoDB(result);
  }
};

const checkUrl = (url) => {
  return new Promise((resolve) => {
    const startTime = Date.now();
    https.get(url, (res) => {
      const latency = Date.now() - startTime;
      const isSuccess = res.statusCode === 200;
      resolve({ url, latency, isSuccess });
    }).on('error', (err) => {
      resolve({ url, latency: Date.now() - startTime, isSuccess: false });
    });
  });
};

const publishMetrics = (result) => {
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
  return cloudwatch.putMetricData(params).promise();
};

const saveToDynamoDB = (result) => {
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
  return dynamodb.put(params).promise();
};