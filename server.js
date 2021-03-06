const WebSocket = require('ws');
const Rcon = require('modern-rcon');

const config = {
  WEBSOCKET_PORT: 8888,
  RCON_HOST: process.env.RCON_HOST,
  RCON_PORT: Number(process.env.RCON_PORT) || 25575,
  RCON_PASSWORD: process.env.RCON_PASSWORD,
  RCON_TIMEOUT: process.env.RCON_TIMEOUT || 5000,
  frequency: 1000,
  debug: process.env.DEBUG || false
};

var rcon,
    webSocketServer,
    interval,
    connections = [], 
    lastData = {},
    rconTimeout,
    rconErrorCount = 0;

initializeRcon = (config) => {
  console.info(`Initializing RCON connection to ${config.RCON_HOST}:${config.RCON_PORT}`);
  try {
    rcon = new Rcon(config.RCON_HOST, config.RCON_PORT, config.RCON_PASSWORD, config.RCON_TIMEOUT);
    connectRcon();
  }catch(error) {
    console.error(`Failed to initialize RCON connection: `, error);
  }
};

connectRcon = () => {
  if (rcon && !rcon.hasAuthed) {
    console.info('Attempting to establish an RCON connection');
    try {
      rcon.connect().then(() => {
        console.info('RCON connection established');
        rconErrorCount = 0;
        clearRconTimeout();
      }).catch((error) => {
        console.error('There was an error creating an RCON connection: ', error);
        clearRconTimeout();
      });
    }catch(error) {
      console.error('Error establishing an RCON connection: ', error);
      clearRconTimeout();
    }
  }
};

resetRcon = () => {
  console.info('Too many RCON errors, attempting to re-establish connection...');
  rcon.disconnect().then(connectRcon).catch((error) => {
    console.error('Error disconnecting RCON: ', error);
  });
};

clearRconTimeout = () => {
  if (rconTimeout) {
    clearTimeout(rconTimeout);
  }
  rconTimeout = null;
};

initializeWebSocketServer = (config) => {
  console.info(`Starting WebSocket Server on port ${config.WEBSOCKET_PORT}`);
  try {
    webSocketServer = new WebSocket.Server({
      port: config.WEBSOCKET_PORT
    });
    webSocketServer.on('connection', openWebSocketConnection);
  } catch(error) {
    console.error(`Failed to initialize WebSocket Server: `, error);
  }
};

openWebSocketConnection = (ws) => {
  console.info(`WebSocket connection opened`);
  connections.push(ws);
  ws.onclose = () => { closeWebSocketConnection(ws); };
  ws.send(JSON.stringify(lastData));
};

closeWebSocketConnection = (ws) => {
  let index = connections.indexOf(ws);
  connections.splice(index,1);
  console.info(`WebSocket connection closed at index ${index}`);
};

sendPlayerData = (data) => {
  if (config.debug) {
    console.info(`Sending player data to ${connections.length} connections`, data);
  }
  lastData = data;
  connections.forEach((ws) => {
    ws.send(JSON.stringify(data));
  });
};

getPlayerData = () => {
  if (!rcon || !rcon.hasAuthed || !rconTimeout) {
    rconTimeout = setTimeout(connectRcon, 3000);
  }
  if (rcon && rcon.hasAuthed && connections.length && rconErrorCount < 5) {
    getPlayers()
      .then(getAllPlayerCoords)
      .then(unpackPlayerData)
      .then(sendPlayerData)
      .catch((error) => {
        //console.error('An error occured trying to get player data: ', error);
        rconErrorCount++;
        if (rconErrorCount > 5) {
          resetRcon();
        }
    });
  }
};

unpackPlayerData = (dataArray) => {
  let data = {};
  dataArray.forEach((element) => {
    data[element.name] = {
      name: element.name,
      x: element.x,
      y: element.y,
      z: element.z,
      dimension: element.dimension
    };
  });
  return data;
};

getPlayers = () => {
  return rcon.send('list').then(parsePlayers);
};

parsePlayers = (listResults) => {
  let total = Number((/\d+/).exec(listResults)[0]);
  let list = [];
  
  if (total) {
    list = listResults.split(':')[1].split(',').map((name) => {return name.trim()});
  }
  
  return list;
};

getAllPlayerCoords = (playerList) => {
  return Promise.all(playerList.map(getPlayerCoords));
};

getPlayerCoords = (playerName) => {
  return rcon.send(`data get entity ${playerName} Pos`)
          .then(parsePlayerCoords)
          .then(data => {
              return {name: playerName, x: data.x, y: data.y, z: data.z};
          })
          .then(getPlayerDimension);
};

parsePlayerCoords = (playerResult) => {
  let data = playerResult.split(':')[1].replace(/[d \[ \]]/g,'').split(',');
  
  return {
    x: Number(data[0]),
    y: Number(data[1]),
    z: Number(data[2])
  };
};

getPlayerDimension = (playerData) => {
  return rcon.send(`data get entity ${playerData.name} Dimension`)
          .then(parsePlayerDimension)
          .then(dimensionData => {
            return {
              name: playerData.name,
              x: playerData.x,
              y: playerData.y,
              z: playerData.z,
              dimension: dimensionData
            };
          });
};

parsePlayerDimension = (playerResult) => {
  let data = playerResult.split(':')[1].trim();
  
  return data;
};

initializeWebSocketServer(config);
initializeRcon(config);

interval = setInterval(getPlayerData, config.frequency);