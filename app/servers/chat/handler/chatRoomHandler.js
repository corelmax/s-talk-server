"use strict";
var Mcontroller = require("../../../controller/ChatRoomManager");
var UserManager_1 = require("../../../controller/UserManager");
var Code_1 = require("../../../../shared/Code");
var tokenService_1 = require("../../../services/tokenService");
var mongodb = require('mongodb');
var crypto = require('crypto');
var Room = require('../../../model/Room');
var UserRole_1 = require('../../../model/UserRole');
var async = require('async');
var webConfig = require('../../../../config/webConfig.json');
var ObjectID = mongodb.ObjectID;
var chatRoomManager = Mcontroller.ChatRoomManager.getInstance();
var userManager = UserManager_1.UserManager.getInstance();
var tokenService = new tokenService_1.default();
var channelService;
module.exports = function (app) {
    console.info("instanctiate ChatRoomHandler.");
    return new ChatRoomHandler(app);
};
var ChatRoomHandler = function (app) {
    this.app = app;
    channelService = app.get('channelService');
};
var handler = ChatRoomHandler.prototype;
handler.requestCreateProjectBase = function (msg, session, next) {
    var self = this;
    var groupName = msg.groupName;
    var members = JSON.parse(msg.members);
    if (!groupName || !members) {
        var errMessage = "cannot create group may be you missing some variable.";
        console.error(errMessage);
        next(null, { code: Code_1.default.FAIL, message: errMessage });
        return;
    }
    var creator = session.uid;
    if (!creator) {
        var message = "creator id is invalid.";
        console.error(message);
        next(null, { code: Code_1.default.FAIL, message: message });
        return;
    }
    userManager.getCreatorPermission(creator, function (err, res) {
        var message = "creator permission is invalid.";
        if (err || res === null) {
            console.error(message);
            next(null, { code: Code_1.default.FAIL, message: message });
            return;
        }
        else {
            if (res.role !== UserRole_1.default.personnel) {
                chatRoomManager.createProjectBaseGroup(groupName, members, function (err, result) {
                    console.info("createProjectBaseGroup response: ", result);
                    var room = JSON.parse(JSON.stringify(result[0]));
                    next(null, { code: Code_1.default.OK, data: room });
                    //<!-- Update list of roomsMember mapping.
                    var accountService = self.app.rpc.auth.getAccountService(session);
                    accountService.addRoom(result[0]);
                    var memberIds = new Array();
                    room.members.forEach(function (value) {
                        memberIds.push(value.id);
                    });
                    //<!-- Add rid to each user members.
                    userManager.AddRoomIdToRoomAccessField(room._id, memberIds, new Date(), function (err, res) {
                        //<!-- Now get roomAccess data for user who is online and then push data to them.
                        memberIds.forEach(function (id) {
                            var accountService = self.app.rpc.auth.getAccountService(session);
                            accountService.getOnlineUser(id, function (err, user) {
                                if (!err && user !== null) {
                                    userManager.getRoomAccessForUser(user.uid, function (err, roomAccess) {
                                        //<!-- Now push roomAccess data to user.
                                        var param = {
                                            route: Code_1.default.sharedEvents.onAddRoomAccess,
                                            data: roomAccess
                                        };
                                        var pushTarget = new Array();
                                        var target = { uid: user.uid, sid: user.serverId };
                                        pushTarget.push(target);
                                        channelService.pushMessageByUids(param.route, param.data, pushTarget);
                                    });
                                }
                            });
                        });
                    });
                    //<!-- Notice all member of new room to know they have a new room.   
                    var param = {
                        route: Code_1.default.sharedEvents.onCreateGroupSuccess,
                        data: room
                    };
                    var pushGroup = new Array();
                    members.forEach(function (member) {
                        var accountService = self.app.rpc.auth.getAccountService(session);
                        accountService.getOnlineUser(member.id, function (err, user) {
                            if (!err) {
                                var item = { uid: user.uid, sid: user.serverId };
                                pushGroup.push(item);
                            }
                        });
                    });
                    channelService.pushMessageByUids(param.route, param.data, pushGroup);
                });
            }
            else {
                next(null, { code: Code_1.default.FAIL, message: message });
            }
        }
    });
};
handler.editMemberInfoInProjectBase = function (msg, session, next) {
    var self = this;
    var roomId = msg.roomId;
    var roomType = msg.roomType;
    var member = JSON.parse(msg.member);
    if (!roomId || !member || !roomType) {
        var message = "Some require parameters is missing or invalid.";
        console.error(message);
        next(null, { code: Code_1.default.FAIL, message: message });
        return;
    }
    //<!-- First checking room type for edit members permission.
    if (roomType !== Room.RoomType[Room.RoomType.projectBaseGroup]) {
        var message = "Room type is invalid this cannot edit groups.";
        console.error(message);
        next(null, { code: Code_1.default.FAIL, message: message });
        return;
    }
    chatRoomManager.editMemberInfoInProjectBase(roomId, member, function (err, res) {
        if (!err && res !== null) {
            console.log("editMemberInfoInProjectBase, result is : ", res.result);
            chatRoomManager.GetChatRoomInfo({ _id: new ObjectID(roomId) }, null, function (roomInfo) {
                var room = JSON.parse(JSON.stringify(roomInfo));
                pushMemberInfoToAllMembersOfRoom(self.app, session, room, member);
                //<!-- Unnecesary to update roomMembers Map.
                //var roomObj = { _id: roomInfo._id, members: roomInfo.members };
                //chatService.updateRoomMembers(roomObj);
            });
        }
        else {
            console.error(err);
        }
    });
    next(null, { code: Code_1.default.OK });
};
/** user create new group chat.
    * @param : msg request
    * groupName:string,
    * memberIds:string[]
    * type: isPrivate <bool>
    * *******************************
    * @Return: group_id.
    */
handler.userCreateGroupChat = function (msg, session, next) {
    var self = this;
    var groupName = msg.groupName;
    var memberIds = JSON.parse(msg.memberIds);
    if (!groupName || !memberIds) {
        var errMessage = "cannot create group may be you missing some variable.";
        console.error(errMessage);
        next(null, { code: Code_1.default.FAIL, message: errMessage });
        return;
    }
    chatRoomManager.createPrivateGroup(groupName, memberIds, function (err, result) {
        if (result !== null) {
            console.info("CreateGroupChatRoom response: ", result);
            var room = JSON.parse(JSON.stringify(result[0]));
            next(null, { code: Code_1.default.OK, data: room });
            //<!-- Update list of roomsMember mapping.
            var accountService = self.app.rpc.auth.getAccountService(session);
            accountService.addRoom(result[0]);
            pushNewRoomAccessToNewMembers(self.app, session, room._id, room.members);
            var memberIds = new Array();
            room.members.forEach(function (value) {
                memberIds.push(value.id);
            });
            //<!-- Notice all member of new room to know they have a new room.   
            var param = {
                route: Code_1.default.sharedEvents.onCreateGroupSuccess,
                data: room
            };
            var pushGroup = new Array();
            memberIds.forEach(function (element) {
                var accountService = self.app.rpc.auth.getAccountService(session);
                accountService.getOnlineUser(element, function (err, user) {
                    if (!err) {
                        var item = { uid: user.uid, sid: user.serverId };
                        pushGroup.push(item);
                    }
                });
            });
            channelService.pushMessageByUids(param.route, param.data, pushGroup);
        }
        else {
            next(null, { code: Code_1.default.FAIL, message: "CreateGroupChatRoom has a problem...T_T" });
        }
    });
};
/**
* require
- group_id for relation of imagePath,
- path of image container,
* return success respone.
*/
handler.updateGroupImage = function (msg, session, next) {
    var self = this;
    var rid = msg.groupId;
    var newUrl = msg.path;
    if (!rid || !newUrl) {
        next(null, { code: Code_1.default.FAIL, message: "groupId or pathUrl is empty or invalid." });
        return;
    }
    var objId = new ObjectID(rid);
    if (!objId) {
        next(null, { code: Code_1.default.FAIL, message: "groupId is invalid." });
        return;
    }
    chatRoomManager.updateGroupImage(rid, newUrl, function (err, res) {
        if (!err) {
            chatRoomManager.GetChatRoomInfo({ _id: new ObjectID(rid) }, null, function (res) {
                if (res !== null) {
                    pushRoomImageToAllMember(self.app, session, res);
                }
            });
        }
    });
    next(null, { code: Code_1.default.OK });
};
/**
* editGroupMembers method.
* provide edit member for private group only.
*/
handler.editGroupMembers = function (msg, session, next) {
    var self = this;
    var editType = msg.editType;
    var roomId = msg.roomId;
    var roomType = msg.roomType;
    var members = JSON.parse(msg.members);
    if (!editType || !roomId || !members || members.length == 0 || !roomType) {
        var message = "Some require parameters is missing or invalid.";
        console.error(message);
        next(null, { code: Code_1.default.FAIL, message: message });
        return;
    }
    //<!-- First checking room type for edit members permission.
    if (roomType === Room.RoomType[Room.RoomType.organizationGroup] || roomType === Room.RoomType[Room.RoomType.privateChat]) {
        var message = "Room type is invalid this group cannot edit.";
        console.error(message);
        next(null, { code: Code_1.default.FAIL, message: message });
        return;
    }
    var editedMembers = new Array();
    members.forEach(function (element) {
        var member = new Room.Member();
        member.id = element;
        editedMembers.push(member);
    });
    chatRoomManager.editGroupMembers(editType, roomId, editedMembers, function (err, res) {
        if (err) {
            console.error(err);
        }
        else {
            console.log("editGroupMembers : type %s : result is", editType, res.result);
            chatRoomManager.GetChatRoomInfo({ _id: new ObjectID(roomId) }, null, function (res) {
                if (res !== null) {
                    pushRoomInfoToAllMember(self.app, session, res, editType, editedMembers);
                    if (editType === "add") {
                        pushNewRoomAccessToNewMembers(self.app, session, res._id, editedMembers);
                    }
                    var roomObj = { _id: res._id, members: res.members };
                    var accountService = self.app.rpc.auth.getAccountService(session);
                    accountService.addRoom(roomObj);
                }
            });
        }
    });
    next(null, { code: Code_1.default.OK });
};
function pushNewRoomAccessToNewMembers(app, session, rid, targetMembers) {
    var memberIds = new Array();
    async.map(targetMembers, function iterator(item, cb) {
        memberIds.push(item.id);
        cb(null, null);
    }, function done(err, results) {
        //<!-- Add rid to roomAccess data for each member. And then push new roomAccess info to all members.
        userManager.AddRoomIdToRoomAccessField(rid, memberIds, new Date(), function (err, res) {
            //<!-- Now get roomAccess data for user who is online and then push data to them.
            memberIds.forEach(function (id) {
                var accountService = app.rpc.auth.getAccountService(session);
                accountService.getOnlineUser(id, function (err, user) {
                    if (!err && user !== null) {
                        userManager.getRoomAccessForUser(user.uid, function (err, roomAccess) {
                            //<!-- Now push roomAccess data to user.
                            var param = {
                                route: Code_1.default.sharedEvents.onAddRoomAccess,
                                data: roomAccess
                            };
                            var pushTarget = new Array();
                            var target = { uid: user.uid, sid: user.serverId };
                            pushTarget.push(target);
                            channelService.pushMessageByUids(param.route, param.data, pushTarget);
                        });
                    }
                });
            });
        });
    });
}
/**
* editGroupName method.
* provide edit name for private group only.
*/
handler.editGroupName = function (msg, session, next) {
    var self = this;
    var newGroupName = msg.newGroupName;
    var roomId = msg.roomId;
    var roomType = msg.roomType;
    if (!roomId || !roomType || !newGroupName) {
        var errMessage = "Some require params is invalid.";
        console.error(errMessage);
        next(null, { code: Code_1.default.FAIL, message: errMessage });
        return;
    }
    //<!-- First checkiung room type for edit members permission.
    if (roomType === Room.RoomType[Room.RoomType.organizationGroup] || roomType === Room.RoomType[Room.RoomType.privateChat]) {
        var message = "Room type is invalid this cannot edit groups.";
        console.error(message);
        next(null, { code: Code_1.default.FAIL, message: message });
        return;
    }
    chatRoomManager.editGroupName(roomId, newGroupName, function (err, res) {
        console.log("editGroupName response. ", res.result);
        chatRoomManager.GetChatRoomInfo({ _id: new ObjectID(roomId) }, null, function (res) {
            if (res !== null) {
                pushRoomNameToAllMember(self.app, session, res);
            }
        });
    });
    next(null, { code: Code_1.default.OK });
};
/**
 * require: roomId, lastAccessTimeOfRoom
 * **********************************************
 *@return : unread message count of room.
 *@return : last message of room.
 */
handler.getUnreadRoomMessage = function (msg, session, next) {
    var self = this;
    var roomId = msg.roomId;
    var lastAccessTime = msg.lastAccessTime;
    var token = msg.token;
    var uid = session.uid;
    if (!roomId || !lastAccessTime || !uid) {
        var msgs = "roomId, lastAccessTime or uid is empty or invalid.";
        next(null, { code: Code_1.default.FAIL, message: msgs });
        return;
    }
    var _timeOut = setTimeout(function () {
        next(null, { code: Code_1.default.RequestTimeout, message: "getUnreadRoomMessage request timeout." });
        return;
    }, webConfig.timeout);
    self.app.rpc.auth.authRemote.checkedCanAccessRoom(session, roomId, uid, function (err, res) {
        if (err || res === false) {
            clearTimeout(_timeOut);
            next(null, { code: Code_1.default.FAIL, message: "cannot access your request room." });
        }
        else {
            chatRoomManager.getUnreadMsgCountAndLastMsgContentInRoom(roomId, lastAccessTime, function (err, res) {
                console.log("GetUnreadMsgOfRoom response: ", res);
                if (err) {
                    clearTimeout(_timeOut);
                    next(null, { code: Code_1.default.FAIL, message: err });
                }
                else {
                    clearTimeout(_timeOut);
                    next(null, { code: Code_1.default.OK, data: res });
                }
            });
        }
    });
};
/**
* Require msg.roomId,
* Return, room model.
*/
handler.getRoomInfo = function (msg, session, next) {
    var self = this;
    var rid = msg.roomId;
    var uid = session.uid;
    if (!rid || !uid) {
        next(null, { code: Code_1.default.FAIL, message: "cannot get roominfo of empty rid." });
        return;
    }
    self.app.rpc.auth.authRemote.checkedCanAccessRoom(session, rid, uid, function (err, res) {
        console.log("checkedCanAccessRoom: ", res);
        if (err || res === false) {
            next(null, { code: Code_1.default.FAIL, message: "cannot access your request room." });
        }
        else {
            chatRoomManager.GetChatRoomInfo({ _id: new ObjectID(rid) }, null, function (res) {
                if (!!res) {
                    next(null, { code: Code_1.default.OK, data: res });
                }
                else {
                    next(null, { code: Code_1.default.FAIL, message: "Your request roomInfo is no longer." });
                }
            });
        }
    });
};
/* Require owner memberId and roommate id.
* For get or create one-to-one chat room.
*/
handler.getRoomById = function (msg, session, next) {
    var self = this;
    var token = msg.token;
    var owner = msg.ownerId;
    var roommate = msg.roommateId;
    if (!owner || !roommate) {
        next(null, { code: Code_1.default.FAIL, message: "some params is invalid." });
        return;
    }
    self.app.rpc.auth.authRemote.tokenService(session, token, function (err, res) {
        if (err) {
            console.log(err);
            next(err, res);
        }
        else {
            var id = '';
            if (owner < roommate) {
                id = owner.concat(roommate);
            }
            else {
                id = roommate.concat(owner);
            }
            var md = crypto.createHash('md5');
            md.update(id);
            var hexCode = md.digest('hex');
            console.log("hexcode: ", hexCode);
            var roomId = hexCode.slice(0, 24);
            chatRoomManager.GetChatRoomInfo({ _id: new ObjectID(roomId) }, null, function (result) {
                console.info("GetChatRoom", result);
                if (result !== null) {
                    var obj = JSON.parse(JSON.stringify(result));
                    next(null, { code: Code_1.default.OK, data: obj });
                }
                else {
                    chatRoomManager.createPrivateChatRoom({ _id: new ObjectID(roomId), members: [owner, roommate] }, function (err, result) {
                        console.info("Create Private Chat Room: ", result);
                        if (result !== null) {
                            var obj = JSON.parse(JSON.stringify(result));
                            next(null, { code: Code_1.default.OK, data: obj });
                            var roomId = result._id;
                            //  var roomObj = JSON.parse(JSON.stringify(result));
                            var members = new Array();
                            for (var i in result.members) {
                                members.push(result.members[i]);
                            }
                            var roomMemberData = { _id: roomId, members: members };
                            self.app.rpc.auth.authRemote.updateRoomMembers(session, roomMemberData, null);
                            //<!-- Push updated lastAccessRoom fields to all members.
                            async.each(members, function (member, cb) {
                                //<!-- Add rid to user members lastAccessField.
                                userManager.AddRoomIdToRoomAccessFieldForUser(roomId, member.id, new Date(), function (err, res) {
                                    if (err) {
                                        cb(err);
                                    }
                                    else {
                                        var accountService = self.app.rpc.auth.getAccountService(session);
                                        accountService.getOnlineUser(member.id, function (err, user) {
                                            if (err) {
                                                console.error(err);
                                            }
                                            else {
                                                //<!-- Dont use getRoomAccessOfRoomId it not work when insert and then find db.
                                                userManager.getRoomAccessForUser(member.id, function (err, roomAccess) {
                                                    if (err) {
                                                        console.error(err);
                                                    }
                                                    else {
                                                        var targetId = { uid: user.uid, sid: user.serverId };
                                                        var pushGroup = new Array();
                                                        pushGroup.push(targetId);
                                                        var param = {
                                                            route: Code_1.default.sharedEvents.onAddRoomAccess,
                                                            data: roomAccess
                                                        };
                                                        channelService.pushMessageByUids(param.route, param.data, pushGroup);
                                                    }
                                                });
                                            }
                                        });
                                    }
                                });
                            }, function (errCb) {
                                console.error("AddRoomIdToRoomAccessFieldForUser_fail", errCb);
                            });
                        }
                        else {
                            next(null, {
                                code: Code_1.default.FAIL,
                                message: "have no a room."
                            });
                        }
                    });
                }
            });
        }
    });
};
var pushRoomInfoToAllMember = function (app, session, roomInfo, editType, editedMembers) {
    console.log("pushRoomInfoToAllMember: ", roomInfo);
    var roomMembers = JSON.parse(JSON.stringify(roomInfo.members));
    if (editType === "remove") {
        editedMembers.forEach(function (element) {
            roomMembers.push(element);
        });
    }
    var params = {
        route: Code_1.default.sharedEvents.onEditGroupMembers,
        data: roomInfo
    };
    var pushTargets = new Array();
    async.series([function (cb) {
            roomMembers.forEach(function (element) {
                var accountService = app.rpc.auth.getAccountService(session);
                accountService.getOnlineUser(element.id, function (err, user) {
                    if (!err) {
                        var target = { uid: user.uid, sid: user.serverId };
                        pushTargets.push(target);
                    }
                });
            });
            cb(null, cb);
        }], function (callback) {
        channelService.pushMessageByUids(params.route, params.data, pushTargets);
    });
};
var pushRoomNameToAllMember = function (app, session, roomInfo) {
    console.log("pushRoomNameToAllMember: ", roomInfo);
    var roomMembers = JSON.parse(JSON.stringify(roomInfo.members));
    var params = {
        route: Code_1.default.sharedEvents.onEditGroupName,
        data: { _id: roomInfo._id, name: roomInfo.name }
    };
    var pushTargets = new Array();
    async.series([function (cb) {
            roomMembers.forEach(function (element) {
                var accountService = app.rpc.auth.getAccountService(session);
                accountService.getOnlineUser(element.id, function (err, user) {
                    if (!err) {
                        var target = { uid: user.uid, sid: user.serverId };
                        pushTargets.push(target);
                    }
                });
            });
            cb(null, cb);
        }], function (callback) {
        channelService.pushMessageByUids(params.route, params.data, pushTargets);
    });
};
var pushRoomImageToAllMember = function (app, session, roomInfo) {
    console.log("pushRoomImageToAllMember: ", roomInfo);
    var roomMembers = JSON.parse(JSON.stringify(roomInfo.members));
    var params = {
        route: Code_1.default.sharedEvents.onEditGroupImage,
        data: { _id: roomInfo._id, image: roomInfo.image }
    };
    var pushTargets = new Array();
    async.series([function (cb) {
            roomMembers.forEach(function (element) {
                var accountService = app.rpc.auth.getAccountService(session);
                accountService.getOnlineUser(element.id, function (err, user) {
                    if (!err) {
                        var target = { uid: user.uid, sid: user.serverId };
                        pushTargets.push(target);
                    }
                });
            });
            cb(null, cb);
        }], function (callback) {
        channelService.pushMessageByUids(params.route, params.data, pushTargets);
    });
};
/**
 * Push roomId , editedMember to all members of room when has member info edited.
 */
function pushMemberInfoToAllMembersOfRoom(app, session, roomInfo, editedMember) {
    var params = {
        route: Code_1.default.sharedEvents.onUpdateMemberInfoInProjectBase,
        data: { roomId: roomInfo._id, editMember: editedMember }
    };
    var pushTargets = new Array();
    async.series([function (cb) {
            roomInfo.members.forEach(function (member) {
                var accountService = app.rpc.auth.getAccountService(session);
                accountService.getOnlineUser(member.id, function (err, user) {
                    if (!err && user !== null) {
                        var item = { uid: user.uid, sid: user.serverId };
                        pushTargets.push(item);
                    }
                });
            });
            cb(null, cb);
        }], function (callback) {
        channelService.pushMessageByUids(params.route, params.data, pushTargets);
    });
}
