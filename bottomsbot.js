
process.on('unhandledRejection', (reason, promise) => {
    console.log('unhandledRejection: ', reason, promise);
    setTimeout(()=>{ 
        process.exit();
    }, 3000);
});

let level = require('level');
let TwitchJs = require('twitch-js').default;

let RateLimitChain = require('./RateLimit.js').RateLimitChain;

let default_settings = require('./default_settings.json');
let auth = require('./auth.json');

// actual chat rate limit is 20 per 30s
let chat_rate_limit = new RateLimitChain(15, 30000);

// whispers rate limit: "3 per second, up to 100 per minute"
let whisper_rate_limit_1 = new RateLimitChain(3, 1000);
let whisper_rate_limit_2 = new RateLimitChain(100, 60000);


const syllable_regex = /[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/gi;

let db = level('./bottomsbot.db');

let channels = {};
let joins = [];

let chatbot = new TwitchJs({
    token: auth.oauth_token,
    username: auth.username
});
chatbot.chat.connect().then(global_user_state => {
    let chat = chatbot.chat;
    let own_channel = `#${auth.username}`;
    chat.join(own_channel).then(channel_state => {

        function maybeWhisper(user, message) {
            if(whisper_rate_limit_1.attempt() && whisper_rate_limit_2.attempt()) {
                //chat.say(`#${auth.username}`, `.w ${user} ${message}`);
                //return true;
                // OKAY NEVERMIND ONLY VERIFIED BOTS CAN WHISPER
                // https://discuss.dev.twitch.tv/t/accessing-whispers-with-bots/26208/15
                // https://dev.twitch.tv/limit-increase
            }
            return false;
        }
    
        function maybeSay(channel, message) {
            if(chat_rate_limit.attempt()) {
                chat.say(channel, message);
            }
        }
    
        function join(channel) {
            joins.push(channel);
            channels[channel] = {};
            db.put(`join.${channel}`, JSON.stringify(channels[channel]));
            return true;
        }
    
        function leave(channel) {
            delete channels[channel];
            db.del(`join.${channel}`);
            chat.part(channel); // I dunno if this is rate limited...
            return true;
        }
    
        function doCommand(channel, user, msg) {
            let args = msg.split(' ');
            if(!args.length) return;
            let cmd = args.shift().toLowerCase();
            if(cmd == "!joinme") {
                maybeSay(channel, `Joining #${user}. Keep in miiind ${user}, if I'm responding too often, you can try e.g. !response_frequency 0.04`);
                return join(`#${user}`);
            } else if(cmd == "!leaveme") {
                maybeSay(channel, `Leaving #${user}.`);
                return leave(`#${user}`);
            } else if(cmd == "!bottoms") {
                if(!channels[channel]) {
                    maybeSay(channel, `@${user} Use !joinme before adjusting other settings.`);
                    return true;
                }
                let settings = {};
                Object.assign(settings, default_settings);
                Object.assign(settings, channels[channel]);
                if(chat_rate_limit.attempt()) {
                    maybeSay(channel, `@${user} settings for ${channel}: ${JSON.stringify(settings)}`);
                }
                return true;
            }
            /*else if(cmd == "!word" && args.length > 0) {
                let ch = `#${user}`;
                if(!channels[ch]) {
                    maybeSay(channel, `@${user} Use !joinme before adjusting other settings.`);
                    return;
                }
                channels[ch].word = args[0];
                db.put(`join.${ch}`, JSON.stringify(channels[ch]));
                maybeSay(channel, `@${user} changed my word to '${args[0]}'`);
                return true;
            }*/
            else if(cmd == "!response_frequency" && args.length > 0) {
                let ch = `#${user}`;
                if(!channels[ch]) {
                    maybeSay(channel, `@${user} Use !joinme before adjusting other settings.`);
                    return true;
                }
                let freq = parseFloat(args[0]);
                if(isNaN(freq) || freq > 1 || freq < 0) {
                    maybeSay(channel, `@${user} Use a range between 0 and 1. Example: !response_frequency ${default_settings.response_frequency / 2}`);
                    return true;
                }
                channels[ch].response_frequency = freq;
                db.put(`join.${ch}`, JSON.stringify(channels[ch]));
                maybeSay(channel, `@${user} changed response_frequency to ${args[0]}`);
                return true;
            }
            else if(cmd == "!word_frequency" && args.length > 0) {
                let ch = `#${user}`;
                if(!channels[ch]) {
                    maybeSay(channel, `@${user} Use !joinme before adjusting other settings.`);
                    return true;
                }
                let freq = parseFloat(args[0]);
                if(isNaN(freq) || freq > 1 || freq < 0) {
                    maybeSay(channel, `@${user} Use a range between 0 and 1. Example: !word_frequency ${default_settings.word_frequency}`);
                    return true;
                }
                channels[ch].word_frequency = freq;
                db.put(`join.${ch}`, JSON.stringify(channels[ch]));
                maybeSay(channel, `@${user} changed word_frequency to ${args[0]}`);
                return true;
            }
        }

        // join all the channels in the db
        channels = {};
        joins = [];
        let db_gte = 'join.';
        db.createReadStream({gte: db_gte, lt: `${db_gte}~`})
        .on('data', data => {
            if(data.value) {
                let channel = data.key.substring(db_gte.length);
                channels[channel] = JSON.parse(data.value);
                joins.push(channel);
            }
        })
        .on('end', () => {
            sendJoins();
            setInterval(sendJoins, 10000);
        });

        // joins 15 channels (avoid rate limit of 20 per 10s)
        function sendJoins() {
            for(let i = 0; joins.length > 0 && i < 15; i++) {
                let idx = Math.floor(Math.random() * joins.length);
                let join = joins[idx];
                joins.splice(idx, 1);
                chat.join(join);
            }
        }

        // handle whispers and chat messages
        chat.on('WHISPER', msg => {
            if(msg.channel == own_channel || msg.channel == `#${msg.username}`) {
                doCommand(msg.channel, msg.username, msg.message);
            }
        });
        chat.on('PRIVMSG', msg => {
            messageCounter.inc();
            if(doCommand(msg.channel, msg.username, msg.message)) {
                return;
            }
            if(!chat_rate_limit.check()) return;
            let settings = {};
            Object.assign(settings, default_settings);
            if(channels[msg.channel]) {
                Object.assign(settings, channels[msg.channel]);
            }
            if(Math.random() > settings.response_frequency) {
                return;
            }
            let replacement_count = 0;
            let words = msg.message.split(' ');
            let action = words[0] == '\u0001ACTION';
            if(action) words.shift();
            for(let i = 0; i < words.length; i++) {
                let word = words[i];
                let pluralizer = word.endsWith('s') ? 's' : '';
                let syllables = word.match(syllable_regex);
                if(!syllables) {
                    if(Math.random() > settings.word_frequency) {
                        continue;
                    }
                    word = settings.word + pluralizer;
                    ++replacement_count;
                } else {
                    for(let s = 0; s < syllables.length; s++) {
                        if(Math.random() > settings.word_frequency) {
                            continue;
                        }
                        let space = syllables[s].startsWith(' ') ? ' ' : '';
                        syllables[s] = space + settings.word + pluralizer;
                        ++replacement_count;
                    }
                    word = syllables.join('');
                }
                words[i] = word;
            }
            if(!replacement_count) {
                replacement_count = 1;
                words[Math.floor(Math.random() * words.length)] = settings.word;
            }
            if(action) words.unshift('/me');
            maybeSay(msg.channel, words.join(' '));
            responseCounter.inc();
            replacedCounter.inc(replacement_count);
        });
    });
});

// admin interface via pm2
const tx2 = require('tx2');

// returns all the channels the bot joins and their settings
// example: pm2 trigger bottomsbot joins
tx2.action('joins', reply => {
    let joins = {};
    let db_gte = 'join.';
    db.createReadStream({gte: db_gte, lt: `${db_gte}~`})
    .on('data', data => {
        if(data.value) {
            let join = data.key.substring(db_gte.length);
            joins[join] = JSON.parse(data.value);
        }
    })
    .on('end', () => {
        reply({joins});
    });
});

// returns a user's channel settings
// e.g. pm2 trigger bottomsbot settings bottomsbot
tx2.action('settings', (opt, reply) => {
    db.get(`join.#${opt}`, (err, value) => {
        if(err) reply('err');
        else reply(value);
    });
});

// e.g. pm2 trigger bottomsbot set bottomsbot.response_frequency=0.001
tx2.action('set', (opt, reply) => {
    try {
        opt = opt.match(/^(.*)\.(.*)=(.*)/);
        if(opt.length != 4) return reply('err');
        opt = opt.slice(1);
        let channel = `#${opt[0]}`, setting = opt[1], value = opt[2];
        let db_key = `join.${channel}`;
        db.get(db_key, (err, settings) => {
            if(err) return reply('err');
            settings = JSON.parse(settings);
            settings[setting] = value;
            channels[channel] = settings;
            settings = JSON.stringify(settings);
            db.put(db_key, settings);
            let r = {};
            r[db_key] = settings;
            reply(r);
        });
    } catch(err) {
        reply('err');
    }
});

// e.g. pm2 trigger bottomsbot unset bottomsbot.response_frequency
tx2.action('unset', (opt, reply) => {
    try {
        opt = opt.match(/^(.*)\.(.*)/);
        if(opt.length != 3) return reply('err');
        opt = opt.slice(1);
        let channel = `#${opt[0]}`, setting = opt[1];
        let db_key = `join.${channel}`;
        db.get(db_key, (err, settings) => {
            if(err) return reply('err');
            settings = JSON.parse(settings);
            delete settings[setting];
            channels[channel] = settings;
            settings = JSON.stringify(settings);
            db.put(db_key, settings);
            let r = {};
            r[db_key] = settings;
            reply(r);
        });
    } catch(err) {
        reply('err');
    }
});

tx2.metric('channels.length', () => Object.keys(channels).length)

let messageCounter = tx2.counter('messages');
let responseCounter = tx2.counter('responses');
let replacedCounter = tx2.counter('replaced');
