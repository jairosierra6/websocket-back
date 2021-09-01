const AWS = require('aws-sdk')
let domain = 'tnpbcownl8.execute-api.us-east-2.amazonaws.com';
const stage = 'dev'
const ENDPOINT = `${domain}/${stage}/`;
const client = new AWS.ApiGatewayManagementApi({endpoint: ENDPOINT});
// dynamoDB 
const ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});
const documentClient = new AWS.DynamoDB.DocumentClient();
//
let usersInEvents = [];

const getEvent = async (eventId) => {
    const params = {
        TableName: 'rooms',
        Key: {
            'roomId': {N: `${eventId}`}
        }
    };
    const query = await ddb.getItem(params).promise();
    console.log('EVENTDATA ===>>>', query.Item);
    return query.Item;
}

const getEvents = async () => {
    let params = {
        TableName: "rooms"
    };
    
    const query = await documentClient.scan(params).promise();
    console.log('TODOSSS ===>>>', query.Items);
    return query.Items;
}

const getUsersByRoom = async (roomId) => {
    let eventData = await getEvent(roomId);
    if (eventData.users.S.charAt(0)== ',') {
        eventData.users.S = eventData.users.S.slice(1); // cleanup
    }
    let parsedUsers = JSON.parse(`[${eventData.users.S}]`);
    return parsedUsers;
}

const removeUser = async (disconnectedUser) => {
    let eventData = await getEvent(disconnectedUser.roomId);
    console.log('BEFORE', eventData.users.S);
    if (eventData.users.S.charAt(0)== ',') {
        eventData.users.S = eventData.users.S.slice(1); // cleanup
    }
    let filteredUsers = JSON.parse(`[${eventData.users.S}]`);
    let originalUsers = filteredUsers.map( x => x.connectionId);
    filteredUsers = filteredUsers.filter( x => x.connectionId != disconnectedUser.connectionId);
    filteredUsers = JSON.stringify(filteredUsers)
    filteredUsers = filteredUsers.slice(1,-1); //remove annoying brackets
    console.log('FILTRADOS>>>> ', filteredUsers)
    const params = {
        TableName: 'rooms',
        Item: {
            'roomId': {N: `${disconnectedUser.roomId}`},
            'eventJSON': eventData.eventJSON,
            'users': {S: filteredUsers},
            'eventName': (eventData.eventName) ? eventData.eventName : 'No name set',
        }
    };
    let payload = {name: 'disconnectedUser', data: { "roomId": disconnectedUser.roomId, "connectionId": disconnectedUser.connectionId}};
    //payload = JSON.stringify(payload);
    console.log('ORIGINALL ', originalUsers);
    await ddb.putItem(params).promise();
    await sendToAll(originalUsers, payload);
}

const putEvent = async (roomId, users, eventJSON, connectionId) => {
    
    
    let connectedUsers = [];
    const eventData = await getEvent(roomId);
    let availableUsers = (eventData.users) ? true : false;
    
    const params = {
        TableName: 'rooms',
        Item: {
            'roomId': {N: `${roomId}`},
            'eventJSON': (eventJSON !== null) ? {S: `${eventJSON}`} : eventData.eventJSON,
            'users': (availableUsers) ? eventData.users : '',
            'eventName': (eventData.eventName) ? eventData.eventName : 'No name set',
        }
    };
    
    console.log('PARAMS ====>>> ', params)
    
    // ====>>>>>>

    if ( users !== null ) {
       if (availableUsers) {
           let toPush = JSON.parse(`[${eventData.users.S}]`)
            toPush.forEach(element => {
               connectedUsers.push(JSON.stringify(element));
               console.log('USER: ', element);
            });
            let payload = {name: 'connectedUsers', data: { connectedUsers }};
            console.log('PAYLOAD SSS> ', payload)
            console.log('USERS TO NOTIFY SSS ', connectedUsers)
            await sendToOne(JSON.parse(users).connectionId, payload);
       }
       connectedUsers.push(users);
       console.log('ConnectedUsers ====>>> ', connectedUsers);
       params.Item.users = {S: `${connectedUsers}`};
       
       // ======>>>>> add new user to the list of active users
        let temp = JSON.parse(users);
        usersInEvents.push({ "roomId": roomId, "connectionId": temp.connectionId});
        console.log('USERSINEVENTS> ',usersInEvents)
    }
    
    // ====>>>>>>
    
    await ddb.putItem(params).promise();
    
    
    const newEventData = await getEvent(roomId);
    if (availableUsers) {
        // ==>cleanup
        if (eventData.users.S.charAt(0)== ',') {
            eventData.users.S = eventData.users.S.slice(1); // cleanup
        }
        console.log('ACAAAAAA ', eventData.users.S, ' TYPE ', eventData)
        // <<==
        // ==>create a userlist to notify
        let usersToNotify;
        try {
            console.log('ERROR HERE ', eventData.users.S)
            usersToNotify = JSON.parse(`[${eventData.users.S}]`);
            usersToNotify = usersToNotify.map((x) => x.connectionId);
        } catch (e) {console.log(e)}
        // <<==
        // ==>Notify users
        if (users) {
            let temp = JSON.parse(users);
            try {
                let payload = {name: 'connectedUser', data: { "roomId": roomId, "connectionId": temp.connectionId, "name": temp.name, "id": temp.id}};
                console.log('PAYLOAD> ', JSON.stringify(payload))
                console.log('USERS TO NOTIFY ', usersToNotify)
                await sendToAll(usersToNotify, payload);
            } catch (e) {console.log(e)}
            // <<==
        }
    }
    
    
    if(eventJSON !== null) { // notify event JSON changes
        await sendToAll(users, {name: 'updatedEvent', data: JSON.stringify(eventJSON)});
    }
}


const getAvailableEvents = async () => {
    // get available events from S3 id's and return them
    const all = [1, 3, 5, 7, 9];
    return Promise.all();
}

const sendToOne = async (id, body) => {
    try {
        await client.postToConnection({
            'ConnectionId': id,
            'Data': Buffer.from(JSON.stringify(body)),
        }).promise();
    } catch (e) {
        console.log('Error notifying client: ', e)
        console.log('ConnectionId: ', id, ' Body> ', body)
    }
};

const sendToAll = async (ids, body) => {
    const all = ids.map( x => sendToOne(x, body));
    return Promise.all(all);
};

exports.handler = async (event) => {
    domain = event.requestContext.domainName;
    console.log('DOMAIN:', domain);
    
    if (event.requestContext) {
        const connectionId = event.requestContext.connectionId;
        const routeKey = event.requestContext.routeKey;
        let body = {};
        try {
            if (event.body) {
                body = JSON.parse(event.body);
            }
        } catch (e) {
            console.log('PARSING ERROR: ', e)
        }
        
        console.log('RouteKey:======>> ', routeKey, '\nBody:', event.body);
        
        switch (routeKey) {
            case '$connect':
               // await sendToOne(connectionId, { availableEvents: `${events}`});
                // code
                break;
            case '$disconnect':
                const disconnectedUser = usersInEvents.find( x => x.connectionId == connectionId ); // FIX HEREE
                console.log('disconnectedUser ', disconnectedUser);
                await removeUser(disconnectedUser);
                break;
            case '$default':
                console.log('PROP1: ', body);
                if (body.action == "$disconnect") {
                    console.log('oe', body, ' ConnnIDDD ', connectionId)
                    const disconnectedUser = usersInEvents.find( x => x.connectionId == connectionId );
                    console.log('disconnectedUser CHIVVVV ', disconnectedUser);
                    await removeUser(disconnectedUser);
                }
                if (body.action == "changedData" || body.action == "locatedOn") {
                    let usersToNotify = await getUsersByRoom(body.roomId);
                    usersToNotify = usersToNotify.map( x => x.connectionId);
                    usersToNotify = usersToNotify.filter( x => x !== connectionId);
                    body.name = body.action;
                    body.connectionId = connectionId;
                    await sendToAll(usersToNotify, body);
                }
                //await getEvent(body);
                // await sendToAll(Object.keys(events), { systemMessage:`{from: ${events[connectionId]}, Body:${event.body}}`});
                break;
            case 'setEvent':
                if (body.users !== null){
                    body.users = JSON.parse(body.users);
                    body.users.connectionId = connectionId;
                    body.users = JSON.stringify(body.users);
                }
                const response = await putEvent(body.roomId, body.users, body.eventJSON, body.connectionId);
                /*/
                events[connectionId] = body.eventId;
                await sendToAll(Object.keys(events), { currentEvents: Object.values(events) });
                await sendToAll(Object.keys(events), { systemMessage: `${Object.values(events)} connected`});
                /*/
                break;
            case 'setUser':
                users[connectionId] = body.eventId;
                await sendToAll(Object.keys(events), { currentEvents: Object.values(events) });
                await sendToAll(Object.keys(events), { systemMessage: `${Object.values(events)} connected` });
                break;
            case 'sendPublic':
                await sendToAll(Object.keys(events), { publicMessage:`{from:${events[connectionId]}, message:${body.message}}`});
                break;
            case 'sendPrivate':
                const to = Object.keys(events).find(key => events[key] === body.to);
                await sendToOne(to, { privateMessage: `${events[connectionId]}: ${body.message}`});
                break;
            case 'listEvents':
                let events = await getEvents();
                await sendToOne(connectionId, {name: 'eventList', data: JSON.stringify(events)});
                break;
        }
    }
    // TODO implement
    const response = {
        statusCode: 200,
        body: JSON.stringify('Hello from Lambda!'),
    };
    return response;
};
