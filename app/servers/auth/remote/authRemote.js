"use strict";
const mongodb = require("mongodb");
const Code_1 = require("../../../../shared/Code");
const tokenService_1 = require("../../../services/tokenService");
const UserManager_1 = require("../../../controller/UserManager");
const Mcontroller = require("../../../controller/ChatRoomManager");
const chatRoomManager = Mcontroller.ChatRoomManager.getInstance();
const tokenService = new tokenService_1.default();
let accountService;
let channelService;
const failedPassword = "Authentication failed.";
const userNotFound = "Authentication failed. User not found.";
module.exports = function (app) {
    return new AuthenRemote(app);
};
const AuthenRemote = function (app) {
    this.app = app;
    channelService = app.get("channelService");
    if (app.getServerType() === 'auth') {
        accountService = app.get('accountService');
        initServer();
    }
};
const remote = AuthenRemote.prototype;
/**
 * Init Server this function call when server start.
 * for load room members from database to cache in memmory before.
 */
const initServer = function () {
    chatRoomManager.getAllRooms(function (rooms) {
        //<!-- To reduce database retrive data. We store rooms Map data to server memory.
        console.log("init AuthenServer for get all rooms data to server memory.");
        accountService.setRoomsMap(rooms, () => { });
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
remote.addRoom = function (room) {
    accountService.addRoom(room);
};
remote.updateRoomMembers = function (data, cb) {
    accountService.addRoom(data);
    setTimeout(function () {
        if (!!cb) {
            cb();
        }
    }, 100);
};
/**
* UpdateRoomsMap When New Room Has Create Then Push New Room To All Members.
*/
remote.updateRoomsMapWhenNewRoomCreated = function (rooms, cb) {
    rooms.forEach(room => {
        if (!accountService.getRoom[room._id]) {
            accountService.addRoom(room);
            //<!-- Notice all member of new room to know they have a new room.   
            let param = {
                route: Code_1.default.sharedEvents.onNewGroupCreated,
                data: room
            };
            let pushGroup = new Array();
            room.members.forEach(member => {
                accountService.getOnlineUser(member._id, (err, user) => {
                    if (!err) {
                        var item = { uid: user.uid, sid: user.serverId };
                        pushGroup.push(item);
                    }
                });
            });
            channelService.pushMessageByUids(param.route, param.data, pushGroup);
        }
    });
    cb();
};
remote.checkedCanAccessRoom = function (roomId, userId, callback) {
    accountService.getRoom(roomId, (err, room) => {
        let result = false;
        if (err || !room) {
            console.warn("getRoom fail", err);
            callback(null, result);
        }
        else {
            result = room.members.some(value => {
                if (value._id === userId) {
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
            console.warn("ensureAuthorized error: ", err);
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
    let query = { _id: new mongodb.ObjectID(msg._id) };
    let projection = {};
    new UserManager_1.UserDataAccessService().getUserProfile(query, projection, function result(err, res) {
        if (err || res === null) {
            let errMsg = "Get my user data is invalid.";
            console.error(errMsg);
            cb({ code: Code_1.default.FAIL, message: errMsg });
            return;
        }
        cb({ code: Code_1.default.OK, data: res[0] });
    });
};
remote.myProfile = function (userId, cb) {
    let query = { _id: new mongodb.ObjectID(userId) };
    let projection = { roomAccess: 0 };
    UserManager_1.UserDataAccessService.prototype.getUserProfile(query, projection, (err, res) => {
        if (res === null || res.length == 0) {
            let errMsg = "Get my user data is invalid.";
            console.warn(errMsg);
            cb({ code: Code_1.default.FAIL, result: errMsg });
            return;
        }
        cb({ code: Code_1.default.OK, result: res });
    });
};
remote.auth = function (email, password, callback) {
    let query = { email: email };
    let projection = { email: 1, password: 1 };
    new UserManager_1.UserDataAccessService().getUserProfile(query, projection, (err, res) => {
        if (!err && res.length > 0) {
            onAuthentication(password, res[0], callback);
        }
        else {
            callback(userNotFound, null);
        }
    });
};
const onAuthentication = function (_password, userInfo, callback) {
    console.log("onAuthentication: ", userInfo);
    if (userInfo !== null) {
        let obj = JSON.parse(JSON.stringify(userInfo));
        if (obj.password === _password) {
            accountService.getOnlineUser(obj._id, (error, user) => {
                if (!user) {
                    // if user is found and password is right
                    // create a token
                    tokenService.signToken(obj, (err, encode) => {
                        callback({
                            code: Code_1.default.OK,
                            uid: obj._id,
                            token: encode
                        });
                    });
                }
                else {
                    console.warn("Duplicate user by onlineUsers collections.");
                    callback({
                        code: Code_1.default.DuplicatedLogin,
                        message: "duplicate log in.",
                        uid: obj._id,
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
