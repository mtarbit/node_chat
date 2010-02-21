HOST = null; // localhost
PORT = 8001;

var fu = require("./fu");
var sys = require("sys");
var url = require("url");

var MESSAGE_BACKLOG = 200;
var SESSION_TIMEOUT = 60 * 1000;
var CALLBACK_TIMEOUT = 30 * 1000;

var channel = new Channel();

function Channel() {

    this.messages = [];
    this.callbacks = [];
    this.sessions = {};
    
    // Periodically clear old callbacks & sessions.
    var self = this;
    setInterval(function(){
        self.expireCallbacks();
        self.expireSessions();
    }, 1000);

    this.appendMessage = function (nick, type, text) {
        var m = {
            nick: nick,
            type: type, // "msg", "join", "part"
            text: text,
            timestamp: (new Date()).getTime()
        };

        switch (type) {
            case 'msg':
                sys.puts('<' + nick + '> ' + text);
                break;
            case 'join':
                sys.puts('[' + nick + '] joined');
                break;
            case 'part':
                sys.puts('[' + nick + '] exited');
                break;
        }

        this.messages.push(m);

        while (this.callbacks.length > 0) {
            this.callbacks.shift().callback([m]);
        }

        while (this.messages.length > MESSAGE_BACKLOG) {
            this.messages.shift();
        }
    };

    this.query = function (since, callback) {
        var matching = [];
        for (var i = 0; i < this.messages.length; i++) {
            var message = this.messages[i];
            if (message.timestamp > since) {
                matching.push(message);
            }
        }

        if (matching.length != 0) {
            callback(matching);
        } else {
            this.callbacks.push({ timestamp: new Date(), callback: callback });
        }
    };

    this.createSession = function (nick) {
        if (nick.length > 50) return null;
        if (/[^\w_\-^!]/.exec(nick)) return null;

        for (var i in this.sessions) {
            var session = this.sessions[i];
            if (session && session.nick === nick) return null;
        }

        var session = new Session(this, nick);
        this.sessions[session.id] = session;
        return session;
    }
    
    this.expireCallbacks = function () {
        var now = new Date();
        while (this.callbacks.length > 0 && now - this.callbacks[0].timestamp > CALLBACK_TIMEOUT) {
            this.callbacks.shift().callback([]);
        }
    };

    this.expireSessions = function () {
        var now = new Date();
        for (var id in this.sessions) {
            if (!this.sessions.hasOwnProperty(id)) continue;

            var session = this.sessions[id];
            if (now - session.timestamp > SESSION_TIMEOUT) {
                session.destroy();
            }

        }
    };

};

function Session(channel, nick) {
    this.channel = channel;
    this.nick = nick;
    this.id = Math.floor(Math.random()*99999999999).toString();
    this.timestamp = new Date();

    this.poke = function () {
        this.timestamp = new Date();
    };

    this.destroy = function () {
        this.channel.appendMessage(this.nick, "part");
        delete this.channel.sessions[this.id];
    };
};

fu.listen(PORT, HOST);

fu.route("/", fu.staticHandler("index.html"));
fu.route("/style.css", fu.staticHandler("style.css"));
fu.route("/client.js", fu.staticHandler("client.js"));
fu.route("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));

fu.route("/who", function (req, res) {
    var nicks = [];
    for (var id in channel.sessions) {
        if (!channel.sessions.hasOwnProperty(id)) continue;
        var session = channel.sessions[id];
        nicks.push(session.nick);
    }
    res.simpleJSON(200, { nicks:nicks });
});

fu.route("/join", function (req, res) {
    var nick = req.data.nick;
    if (nick == null || nick.length == 0) {
        res.simpleJSON(400, { error:"Bad nick." });
        return;
    }

    var session = channel.createSession(nick);
    if (session == null) {
        res.simpleJSON(400, { error:"Nick in use" });
        return;
    }

    channel.appendMessage(session.nick, "join");
    res.simpleJSON(200, { id:session.id, nick:session.nick });
});

fu.route("/part", function (req, res) {
    var id = req.data.id;
    var session;

    if (id && channel.sessions[id]) {
        session = channel.sessions[id];
        session.destroy();
    }

    res.simpleJSON(200, { });
});

fu.route("/recv", function (req, res) {
    if (!req.data.since) {
        res.simpleJSON(400, { error: "Must supply since parameter" });
        return;
    }

    var id = req.data.id;
    var session;
    if (id && channel.sessions[id]) {
        session = channel.sessions[id];
        session.poke();
    }

    var since = parseInt(req.data.since, 10);

    channel.query(since, function (messages) {
        if (session) session.poke();
        res.simpleJSON(200, { messages: messages });
    });
});

fu.route("/send", function (req, res) {
    var id = req.data.id;
    var text = req.data.text;

    var session = channel.sessions[id];
    if (!session || !text) {
        res.simpleJSON(400, { error: "No such session id" });
        return; 
    }

    session.poke();

    channel.appendMessage(session.nick, "msg", text);
    res.simpleJSON(200, {});
});
