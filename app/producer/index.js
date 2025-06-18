const {SQSClient, SendMessageBatchCommand} = require('@aws-sdk/client-sqs');
const sqsClient = new SQSClient({region: process.env.AWS_REGION});

exports.handler = async (event) => {
    const promises = []
    const body = JSON.parse(event.body);
    try {
        // Loop over all provided groups - provided via loadtest.yaml
        for (const group of body.groups) {
            if (group.count > 1000 || body.groups.length > 25) {
                console.error("Maximum allowed number of messages (1000) / groups (25) provided");
                return {
                    statusCode: 400,
                    body: "Maximum number of messages / groups reached"
                }
            }
            // Batches of 10 for SendMessageBatch Call
            for (let i = 0; i < group.count / 10; ++i) {
                promises.push(sendMessageBatch(group))
            }
        }

        // Wait for all to be finished
        await Promise.all(promises)

        return {
            statusCode: 200,
        };
    } catch (error) {
        console.error("Error sending batch messages:", error);
        return {
            statusCode: 500
        }
    }
}

async function sendMessageBatch(event) {
    return await sqsClient.send(messageGroupCommand(event.MessageGroupId));
}

function messageGroupCommand(MessageGroupId) {
    return new SendMessageBatchCommand({
        QueueUrl: process.env.QUEUE_URL,
        Entries: Array.from({length: 10}, (_, i) => {
            if (MessageGroupId != null) {
                return {
                    Id: `${i}`,
                    MessageBody: "Hello Tenant!",
                    MessageGroupId: MessageGroupId
                }
            } else {
                return {
                    Id: `${i}`,
                    MessageBody: "Hello Tenant!"
                }
            }
        })
    })
}
