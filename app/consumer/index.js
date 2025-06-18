export const handler = async (event) => {
    const now = Date.now();
    const tenantCounter = [];

    for (const msg of event.Records) {
        const messageGroupId = msg.attributes.MessageGroupId
        const dwellTime = now - new Date(parseInt(msg.attributes.SentTimestamp));

        if (messageGroupId == null) continue
        tenantCounter.push({"tenant": messageGroupId, "count": 1, "dwellTime": dwellTime});
    }

    const groupedByTenant = Object.groupBy(tenantCounter, item => item.tenant)

    //Will log to Amazon CloudWatch logs and picked up by Contributor Insights rule
    for (const [tenant, items] of Object.entries(groupedByTenant)) {
        console.log(JSON.stringify({"tenant": tenant, "count": items.length}))
    }

    await new Promise((resolve, _) => setTimeout(resolve, 500));

    return {statusCode: 200};
};
