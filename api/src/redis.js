const _ = require('lodash')
const Promise = require('promise')
const berlioz = require('berlioz-connector');
const RedisClustr = require('redis-clustr');
const Redis = require('redis');

var info = {
    client: null,
    servers: [],
    peerInfos: {},
    get: function(name, cb) {
        client = getClient();
        try
        {
            client.get(name, cb);
        }
        catch(ex)
        {
            info.client = null;
            throw ex;
        }
    },
    set: function(name, newValue) {
        client = getClient();
        try
        {
            client.set(name, newValue);
        }
        catch(ex)
        {
            info.client = null;
            throw ex;
        }
    }
}

function getClient() 
{
    if (info.client) {
        return info.client;
    }

    if (info.servers.length == 0) {
        throw new Error('Redis client not available');
    }

    info.client = new RedisClustr({
        servers: info.servers,
        createClient: (port, host, options) => {
            var peer = info.peerInfos[host + ':' + port];
            console.log(peer);
            return getRedisClient(peer, options);
        }
    });

    return info.client;
}

berlioz.service("redis").monitorAll(peers => {
    var servers = [];
    var peerInfos = {

    }
    if (peers) {
        for(var peer of _.values(peers)) {
            peerInfos[peer.address + ':' + peer.port] = peer;
            servers.push({ host: peer.address, port: peer.port });
        }
    }
    if (info.client) {
        info.client.quit();
    }
    console.log("REDIS SERVERS: " + JSON.stringify(servers));
    info.servers = servers;
    info.peerInfos = peerInfos;
})

function getRedisClient(peer, options)
{
    var client = Redis.createClient(peer.port, peer.address, options);
    
    var handler = {
        get: (target, propKey) => {
            console.log('REDIS-WRAPPER: ' + peer.address + ':' + peer.port + ' => ' + propKey);
            var origValue = client[propKey];
            if (propKey == 'set' || propKey == 'get') {
                return processRedisCommand(client, origValue, peer, propKey);
            }
            return origValue;
        }
    };
    return new Proxy({}, handler);
}

function processRedisCommand(client, origValue, peer, propKey)
{
    function inner() {
        var args;
        var origCb = _.last(arguments);
        if (_.isFunction(origCb)) {
            args = _.dropRight(arguments);
        } else {
            args = _.clone(arguments);
            origCb = null;
        }

        return berlioz.service("redis").performExecutor(
            propKey, 
            '/', 
            () => peer,
            origCb, 
            (peer) => {

                return new Promise((resolve, reject) => {
                    console.log('REDIS-WRAPPER-INSIDE: ' + propKey + ' BEGIN');
                    
                    var newCb = (err, reply) => {
                        if (err) {
                            console.log('REDIS-WRAPPER-INSIDE: ' + propKey + ' ERR: ' + err);
                            reject(err);
                        } else {
                            console.log('REDIS-WRAPPER-INSIDE: ' + propKey + ' DONE: ' + reply);
                            resolve(reply);
                        }
                    }
    
                    var myargs = _.clone(args);
                    myargs.push(newCb);
                    console.log('REDIS-WRAPPER-INSIDE: ' + propKey + ', ARGS-LENGTH: ' + myargs.length);
                    console.log('REDIS-WRAPPER-INSIDE: ' + propKey + ', ARGS: ' + myargs);
                    origValue.apply(client, myargs);
                    console.log('REDIS-WRAPPER-INSIDE: ' + propKey + ' END');
                });

            });
    }
    return inner;
}

module.exports = info;