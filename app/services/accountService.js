"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const Code_1 = require("../../shared/Code");
const dispatcher = require("../util/dispatcher");
class AccountService {
    constructor(app) {
        this.uidMap = {};
        this.nameMap = {};
        this.channelMap = {};
        /**
         * onLineUsers the dict keep UID of user who online pair with OnlineUser data structure.
         */
        this.onlineUsers = new Map();
        /**
         * Add records for the specified user
         */
        this.addRecord = function (service, uid, name, sid, channelName) {
            let record = { uid: uid, name: name, sid: sid };
            service.uidMap[uid] = record;
            service.nameMap[name] = record;
            let item = service.channelMap[uid];
            if (!item) {
                item = service.channelMap[uid] = {};
            }
            item[channelName] = 1;
        };
        /**
         * Cehck whether the user has already in the channel
         */
        this.checkDuplicate = function (service, uid, channelName) {
            return !!service.channelMap[uid] && !!service.channelMap[uid][channelName];
        };
        /**
         * Remove records for the specified user and channel pair
         */
        this.removeRecord = function (service, uid, channelName) {
            delete service.channelMap[uid][channelName];
            //    if (utils.size(service.channelMap[uid])) {
            //        return;
            //    }
            // if user not in any channel then clear his records
            this.clearRecords(service, uid);
        };
        /**
         * Clear all records of the user
         */
        this.clearRecords = function (service, uid) {
            delete service.channelMap[uid];
            let record = service.uidMap[uid];
            if (!record) {
                return;
            }
            delete service.uidMap[uid];
            delete service.nameMap[record.name];
        };
        /**
         * Get the connector server id assosiated with the uid
         */
        this.getSidByUid = function (uid, app) {
            let connector = dispatcher.dispatch(uid, app.getServersByType("connector"));
            if (connector) {
                return connector.id;
            }
            return null;
        };
        this.app = app;
        this.uidMap = {};
        this.nameMap = {};
        this.channelMap = {};
    }
    OnlineUsers() {
        if (!this.onlineUsers)
            this.onlineUsers = new Map();
        return this.onlineUsers;
    }
    getOnlineUser(userId, cb) {
        if (!this.onlineUsers)
            this.onlineUsers = new Map();
        if (this.onlineUsers.has(userId)) {
            let user = this.onlineUsers.get(userId);
            cb(null, user);
        }
        else {
            let errMsg = "Specific uid is not online.";
            cb(errMsg, null);
        }
    }
    getOnlineUserByAppId(appId, cb) {
        let results = new Array();
        this.onlineUsers.forEach(value => {
            if (value.applicationId === appId) {
                results.push(value);
            }
        });
        cb(null, results);
    }
    addOnlineUser(user, callback) {
        if (!this.onlineUsers)
            this.onlineUsers = new Map();
        if (!this.onlineUsers.has(user.uid)) {
            this.onlineUsers.set(user.uid, user);
        }
        else {
            console.warn("onlineUsers dict already has value.!");
        }
        callback();
    }
    updateUser(user) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.onlineUsers)
                this.onlineUsers = new Map();
            this.onlineUsers.set(user.uid, user);
            return yield Array.from(this.onlineUsers.values());
        });
    }
    removeOnlineUser(userId) {
        this.onlineUsers.delete(userId);
    }
    get userTransaction() {
        if (!this._userTransaction)
            this._userTransaction = {};
        return this._userTransaction;
    }
    /**
     * Add player into the channel
     *
     * @param {String} uid         user id
     * @param {String} playerName  player's role name
     * @param {String} channelName channel name
     * @return {Number} see code.js
     */
    add(uid, playerName, channelName) {
        let sid = this.getSidByUid(uid, this.app);
        if (!sid) {
            return Code_1.default.CHAT.FA_UNKNOWN_CONNECTOR;
        }
        if (this.checkDuplicate(this, uid, channelName)) {
            return Code_1.default.OK;
        }
        let channel = this.app.get("channelService").getChannel(channelName, true);
        if (!channel) {
            return Code_1.default.CHAT.FA_CHANNEL_CREATE;
        }
        channel.add(uid, sid);
        this.addRecord(this, uid, playerName, sid, channelName);
        return Code_1.default.OK;
    }
    /**
     * User leaves the channel
     *
     * @param  {String} uid         user id
     * @param  {String} channelName channel name
     */
    leave(uid, channelName) {
        let record = this.uidMap[uid];
        let channel = this.app.get("channelService").getChannel(channelName, true);
        if (channel && record) {
            channel.leave(uid, record.sid);
        }
        this.removeRecord(this, uid, channelName);
    }
    /**
     * Kick user from chat service.
     * This operation would remove the user from all channels and
     * clear all the records of the user.
     *
     * @param  {String} uid user id
     */
    kick(uid) {
        let channelNames = this.channelMap[uid];
        let record = this.uidMap[uid];
        if (channelNames && record) {
            // remove user from channels
            let channel;
            for (let name in channelNames) {
                channel = this.app.get("channelService").getChannel(name);
                if (channel) {
                    channel.leave(uid, record.sid);
                }
            }
        }
        this.clearRecords(this, uid);
    }
    /**
     * Push message by the specified channel
     *
     * @param  {String}   channelName channel name
     * @param  {Object}   msg         message json object
     * @param  {Function} cb          callback function
     */
    pushByChannel(channelName, msg, cb) {
        let channel = this.app.get("channelService").getChannel(channelName);
        if (!channel) {
            cb(new Error("channel " + channelName + " dose not exist"));
            return;
        }
        //    channel.pushMessage(Event.chat, msg, cb);
    }
    /**
     * Push message to the specified player
     *
     * @param  {String}   playerName player's role name
     * @param  {Object}   msg        message json object
     * @param  {Function} cb         callback
     */
    pushByPlayerName(playerName, msg, cb) {
        let record = this.nameMap[playerName];
        if (!record) {
            cb(null, Code_1.default.CHAT.FA_USER_NOT_ONLINE);
            return;
        }
        //        this.app.get('channelService').pushMessageByUids(Event.chat, msg, [{ uid: record.uid, sid: record.sid }], cb);
    }
}
exports.AccountService = AccountService;
