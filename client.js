var CONFIG = {
    debug: false,
    nick: "#",
    id: null,
    lastMessageTime: 1
};

var nicks = [];

var util = {
    urlRE: /https?:\/\/([-\w\.]+)+(:\d+)?(\/([^\s]*(\?\S+)?)?)?/g, 

    toStaticHTML: function(str) {
        str = str.replace(/&/g, '&amp;');
        str = str.replace(/</g, '&lt;');
        str = str.replace(/>/g, '&gt;');
        return str;
    }, 

    timeString: function (date) {
        var m = date.getMinutes().toString();
        var h = date.getHours().toString();
        return this.pad(h,2) + ':' + this.pad(m,2);
    },

    pad: function (str, len, pad, dir) {
        var len = len + 1 - str.length;
        if (len < 1) return str;
        pad = new Array(len).join(pad || '0');
        return dir ? str+pad : pad+str;
    },

    rgbPart: function (cap) {
        return Math.floor(Math.random() * Math.min(256, cap));
    },

    rgb: function () {
        var total = 0xFF + 0xCC;
        var r = this.rgbPart(total);
        var g = this.rgbPart(total - r);
        var b = this.rgbPart(total - r - g);
        var c = 'rgb('+r+','+g+','+b+')';
        return c;
    },
    
    randomHexColour: function () {
        // Gives the full range, should really be tonally clamped,
        // so we don't get anything too light or too dark, and ideally
        // wouldn't be random so we didn't get anything too similar.
        var val = Math.floor(Math.random() * 0x1000000);
        var hex = '#' + this.pad(val.toString(16), 6);
        return hex;
    }
};

function addContact(nick) {
    for (var i = 0; i < nicks.length; i++) {
        if (nicks[i].name == nick) return;
    }
    nicks.push({ name:nick, colour:util.rgb() });
}

function addContacts(nicks) {
    for (var i = 0; i < nicks.length; i++) {
        addContact(nicks[i]);
    }
}

function removeContact(nick) {
    for (var i = 0; i < nicks.length; i++) {
        if (nicks[i].name == nick) {
            nicks.splice(i,1);
            break;
        }
    }
}

function getContactByNick(nick) {
    for (var i = 0; i < nicks.length; i++) {
        if (nicks[i].name == nick) {
            return nicks[i];
        }
    }
}

function updateContacts() {
    var items = $.map(nicks, function(nick){
        var you = (nick.name == CONFIG.nick) ? ' <small>(you)</small>' : '';
        return '<li><span style="color:' + nick.colour + ';">' + nick.name + you + '</span></li>';
    });
    $('#contacts ul').html(items.join("\n"));
}

function userJoined(nick, timestamp) {
    addContact(nick);
    updateContacts();
    addMessage(nick, "joined", timestamp, "notice");
}

function userExited(nick, timestamp) {
    removeContact(nick);
    updateContacts();
    addMessage(nick, "left", timestamp, "notice");
}


function addMessage(from, text, time, className) {
    if (text == null) return;

    if (time == null) {
        // if the time is null or undefined, use the current time.
        time = new Date();
    } else if ((time instanceof Date) === false) {
        // if it's a timestamp, interpret it
        time = new Date(time);
    }

    if (from == 'System') {
        className = 'error';
    }
    
    var contact = getContactByNick(from);
    var fromCss = (contact && className != 'notice') ? 'color:' + contact.colour + ';' : '';

    // stringify, htmlify & linkify
    text = new Object(text).toString();
    text = util.toStaticHTML(text);
    text = text.replace(util.urlRE, '<a target="_blank" href="$&">$&</a>');

    var mesg = $('\
        <table class="message">\
            <tr>\
                <td class="date">' + util.timeString(time) + '</td>\
                <td class="nick"><span style="' + fromCss + '">' + from + ':</span></td>\
                <td class="msg-text">' + text + '</td>\
            </tr>\
        </table>\
    ');

    if (className) {
        mesg.addClass(className);
    }
    if (text.indexOf(CONFIG.nick) > -1) {
        mesg.addClass("personal");
    }

    $('#messages .ui-panel').append(mesg);
    
    scrollDown();
}

function send(msg) {
    if (CONFIG.debug === false) {
        req("/send", { id:CONFIG.id, text:msg });
    }
}

function onConnect(session) {
    if (session.error) {
        retry("Error connecting: " + session.error);
        return;
    }

    CONFIG.nick = session.nick;
    CONFIG.id = session.id;
}

function who() {
    req('/who', {}, function(data,status) {
        if (status == 'success') {
            addContacts(data.nicks);
            updateContacts();
        }
    });
}

function validateNick(nick) {
    var errors = [];

    if (nick.length > 50) {
        errors.push("Nick too long. 50 character max.");
    }
    if (/[^\w_\-^!]/.exec(nick)) {
        errors.push("Bad character in nick. Can only have letters, numbers, and '_', '-', '^', '!'");
    }

    if (errors.length) {
        return errors.join("\n");
    } else {
        return false; 
    }
}

var pollingErrors = 0;

function polling(data) {
    if (pollingErrors > 2) {
        connect();
        return;
    }

    if (data && data.messages) {
        for (var i = 0; i < data.messages.length; i++) {
            var message = data.messages[i];

            if (message.timestamp > CONFIG.lastMessageTime) {
                CONFIG.lastMessageTime = message.timestamp;
            }

            switch (message.type) {
                case "msg":
                    addMessage(message.nick, message.text, message.timestamp);
                    break;
                case "join":
                    userJoined(message.nick, message.timestamp);
                    break;
                case "part":
                    userExited(message.nick, message.timestamp);
                    break;
            }
        }
    }

    req('/recv', { since:CONFIG.lastMessageTime, id:CONFIG.id }, function(data) {
            pollingErrors = 0;
            polling(data);
        }, function() {
            pollingErrors += 1;
            addMessage('System', "Polling error. Trying again...");
            setTimeout(polling, 10*1000);
        }
     );
}

function connect() {
    // var nick = prompt("Enter a nickname:");
    var nick = "Guest_" + (new Date()).getTime().toString(36).toUpperCase();
    var error = validateNick(nick);
    if (error) return retry(error);

    req('/join', { nick: nick }, onConnect, function(){
        retry("Couldn't connect. Trying again...");
    });
}

function retry(error) {
    if (error) {
        addMessage('System', error);
    }
    setTimeout(connect, 10*1000);
}

function req(url, data, successFn, failureFn) {
    var o = {
        cache: false,
        type: 'GET', // should be POST
        dataType: 'json',
        url: url
    }

    if (data) o.data = data;
    if (successFn) o.success = successFn;
    if (failureFn) o.error = failureFn;

    $.ajax(o);
}

function fixPanelHeight() {
    var outerA = $('#messages');
    var innerA = outerA.find('.ui-panel');
    var innerB = $('#contacts .ui-panel');

    innerA.height(0);
    innerB.height(0);
    
    var h = outerA.height();
    var p = (parseInt(innerA.css('paddingTop'), 10) * 2)
          + (parseInt(innerA.css('borderTopWidth'), 10) * 2);

    innerA.height(h - p);
    innerB.height(h - p);

    scrollDown();
}

function scrollDown() {
    var inner = $('#messages .ui-panel');
    inner.scrollTop(inner.get(0).scrollHeight - inner.height());
}

$(document).ready(function() {

    $('#input input').keypress(function(e){
        if (e.keyCode == 13) {
            var input = $('#input input');
            var msg = $.trim(input.val());
            if (msg) send(msg);
            input.val('');
        }
    }).focus();

    $(window).resize(fixPanelHeight).trigger('resize');

    connect();
    who();
    polling();
});

$(window).unload(function() {
    req('/part', { id:CONFIG.id });
});
