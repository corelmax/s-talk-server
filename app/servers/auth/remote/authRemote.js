/// <reference path="../../../../typings/index.d.ts" />
"use strict";
var Code_1 = require('../../../../shared/Code');
var tokenService_1 = require('../../../services/tokenService');
var UserManager_1 = require('../../../controller/UserManager');
var Mcontroller = require('../../../controller/ChatRoomManager');
var chatRoomManager = Mcontroller.ChatRoomManager.getInstance();
var tokenService = new tokenService_1.default();
var accountService;
var channelService;
module.exports = function (app) {
    return new AuthenRemote(app);
};
var AuthenRemote = function (app) {
    this.app = app;
    channelService = app.get("channelService");
    if (app.getServerType() === 'auth') {
        accountService = app.get('accountService');
        initServer();
    }
};
var remote = AuthenRemote.prototype;
/**
 * Init Server this function call when server start.
 * for load room members from database to cache in memmory before.
 */
var initServer = function () {
    chatRoomManager.getAllRooms(function (rooms) {
        //<!-- To reduce database retrive data. We store rooms Map data to server memory.
        console.log("init AuthenServer for get all rooms data to server memory.");
        accountService.setRoomsMap(rooms, function () { });
    });
};
/**
 * UpdateOnlineUsers.
 * The func call with 2 scenario,
 * 1. Call when user login success and joining in system.
 * 2. call when user logout.
 */
remote.addOnlineUser = function (user, cb) {
    accountService.addOnlineUser(user, cb);
};
remote.removeOnlineUser = function (userId, cb) {
    accountService.removeOnlineUser(userId);
    cb();
};
remote.getOnlineUser = function (userId, callback) {
    accountService.getOnlineUser(userId, callback);
};
remote.getOnlineUsers = function (callback) {
    callback(null, accountService.OnlineUsers);
};
remote.addUserTransaction = function (userTransac, cb) {
    if (accountService.userTransaction !== null) {
        if (!accountService.userTransaction[userTransac.uid]) {
            accountService.userTransaction[userTransac.uid] = userTransac;
        }
    }
    else {
        console.warn("chatService.userTransaction is null.");
    }
    cb();
};
remote.getUserTransaction = function (uid, cb) {
    if (!!accountService.userTransaction) {
        cb(null, accountService.userTransaction[uid]);
    }
    else {
        cb(new Error("No have userTransaction"), null);
    }
};
remote.getRoomMap = function (rid, callback) {
    accountService.getRoom(rid, callback);
};
remote.updateRoomMembers = function (data, cb) {
    accountService.addRoom(data);
    if (!!cb) {
        cb();
    }
};
/**
* UpdateRoomsMap When New Room Has Create Then Push New Room To All Members.
*/
remote.updateRoomsMapWhenNewRoomCreated = function (rooms, cb) {
    rooms.forEach(function (room) {
        if (!accountService.RoomsMap[room._id]) {
            accountService.addRoom(room);
            //<!-- Notice all member of new room to know they have a new room.   
            var param = {
                route: Code_1.default.sharedEvents.onNewGroupCreated,
                data: room
            };
            var pushGroup_1 = new Array();
            room.members.forEach(function (member) {
                accountService.getOnlineUser(member.id, function (err, user) {
                    if (!err) {
                        var item = { uid: user.uid, sid: user.serverId };
                        pushGroup_1.push(item);
                    }
                });
            });
            channelService.pushMessageByUids(param.route, param.data, pushGroup_1);
        }
    });
    cb();
};
remote.checkedCanAccessRoom = function (roomId, userId, callback) {
    accountService.getRoom(roomId, function (err, room) {
        var result = false;
        if (err || !room) {
            callback(null, result);
        }
        else {
            result = room.members.some(function (value) {
                if (value.id === userId) {
                    return true;
                }
            });
            callback(null, result);
        }
    });
};
remote.tokenService = function (bearerToken, cb) {
    tokenService.ensureAuthorized(bearerToken, function (err, res) {
        if (err) {
            console.info("ensureAuthorized error: ", err);
            cb(err, { code: Code_1.default.FAIL, message: err });
        }
        else {
            cb(null, { code: Code_1.default.OK, decoded: res.decoded });
        }
    });
};
/**
 * route for /me data.
 * require => username, password, bearerToken
 */
remote.me = function (msg, cb) {
    var username = msg.username;
    var password = msg.password;
    var bearerToken = msg.token;
    var query = { username: username.toLowerCase() };
    var projection = { roomAccess: 0 };
    new UserManager_1.UserDataAccessService().getUserProfile(query, projection, function result(err, res) {
        if (err || res === null) {
            var errMsg = "Get my user data is invalid.";
            console.error(errMsg);
            cb({ code: Code_1.default.FAIL, message: errMsg });
            return;
        }
        cb({ code: Code_1.default.OK, data: res[0] });
    });
};
remote.myProfile = function (userId, cb) {
    UserManager_1.UserManager.getInstance().getMemberProfile(userId, function (err, res) {
        if (res === null) {
            var errMsg = "Get my user data is invalid.";
            console.error(errMsg);
            cb({ code: Code_1.default.FAIL, message: errMsg });
            return;
        }
        cb({ code: Code_1.default.OK, data: res });
    });
};
remote.auth = function (email, password, callback) {
    var query = { username: email };
    var projection = { username: 1, password: 1 };
    new UserManager_1.UserDataAccessService().getUserProfile(query, projection, function (err, res) {
        onAuthentication(password, res, callback);
    });
};
var onAuthentication = function (_password, userInfo, callback) {
    console.log("onAuthentication: ", userInfo);
    if (userInfo !== null) {
        var obj_1 = JSON.parse(JSON.stringify(userInfo));
        if (obj_1.password === _password) {
            accountService.getOnlineUser(obj_1._id, function (error, user) {
                if (!user) {
                    // if user is found and password is right
                    // create a token
                    tokenService.signToken(obj_1, function (err, encode) {
                        callback({
                            code: Code_1.default.OK,
                            uid: obj_1._id,
                            token: encode
                        });
                    });
                }
                else {
                    console.warn("Duplicate user by onlineUsers collections.");
                    callback({
                        code: Code_1.default.DuplicatedLogin,
                        message: "duplicate log in.",
                        uid: obj_1._id,
                    });
                }
            });
        }
        else {
            callback({
                code: Code_1.default.FAIL,
                message: "Authentication failed. User not found."
            });
        }
    }
    else {
        callback({
            code: Code_1.default.FAIL,
            message: "Authentication failed. User not found."
        });
    }
};
