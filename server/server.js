var Primus = require('primus')
  , http = require('http');

var async = require('async');

var Dict = require("collections/dict");

// Server data structures
var server = { sparks: new Dict(), sessions: new Dict(), games: new Dict() };

// Initialize server
server.primus = Primus.createServer({port: 8080, transformer: 'websockets', iknowhttpsisbetter: true});

// Handle incoming connections
server.primus.on('connection', function (spark) {
  console.log(spark.id + ' connected');

  // Incoming message handler
  spark.on('data', function message(data) {
    var sessionId = server.sparks.get(spark.id);

    // handle unregistered clients, which are only allowed to register
    if (!sessionId) {
      if (data.type !== 'register') {
         console.log('message from unregistered client ' + spark.id);
         console.log(data);
         return; // todo: error handling
      }
      register(spark, data);
      return;
    }

    var session = server.sessions.get(sessionId);
    if (!session) {
      console.log('missing session ' + sessionId);
      return;
    }

    session.lastMessage = data;
    session.timestamp = new Date();
    switch (data.type) {
      case 'join': join(spark, session, data); break;
      case 'update': update(spark, session, data); break;
    }

  });
});

function register(spark, data) {
  if (data.id == null)
    data.id = spark.id;

  var session = server.sessions.get(data.id);
  if (!session) {
    session = {id: data.id};
    server.sessions.set(data.id, session);
  }

  if (session.spark) {
    server.sparks.delete(session.spark);
  }

  session.spark = spark.id;
  session.lastMessage = data;
  session.timestamp = new Date();
  session.connected = new Date();

  server.sparks.add(session.spark, session.id);
  spark.write({type: 'register', id: data.id});
  console.log('spark ' + session.spark + ' registered to session ' + session.id);
}

function join(spark, session, data) {
  // remove from existing game
  if (session.game) {
    var oldGame = server.games.get(session.game.serverAddress);
    if (oldGame)
      oldGame.sessions.delete(session.id);
  }

  // join new game
  var game = server.games.get(data.serverAddress);
  if (!game) {
    // init game object and save
    game = { sessions: new Dict(), serverAddress: data.serverAddress };
    server.games.set(data.serverAddress, game);
  }
  session.game = { serverAddress: data.serverAddress, name: data.name };

  // store in game session list
  var gameSession = { id: session.id, name: data.name, cells: data.cells }
  game.sessions.set(session.id, gameSession);

  sendGameSessions(game);
}

function update(spark, session, data) {
  switch (data.updateType) {
    case 'blobs': updateBlobs(session, data); break;
    case 'self': updateSelf(session, data); break;
  }
}

function updateBlobs(session, data) {
  var game = server.games.get(session.game.serverAddress);
  sendPayload(game, {type: 'update', updateType: 'blobs', updateData: data.updateData, updateSource: session.id});
}

function updateSelf(session, data) {
  var game = server.games.get(session.game.serverAddress);
  data.updateData.id = session.id;
  game.sessions.set(session.id, data.updateData);
  sendGameSessions(game);
}

function sendGameSessions(game) {
  sendPayload(game, {type: 'update', updateType: 'game', updateData: game });
}

function sendPayload(game, payload) {
  async.each(game.sessions.keys(), function(sessionId, callback) {
    var s = server.sessions.get(sessionId);
    if (s && s.spark) {
      var sp = server.primus.spark(s.spark);
      if (sp) {
        sp.write(payload);
      }

    }
    callback();
  });
}
