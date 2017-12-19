﻿import Code from "../../../../shared/Code";
import User = require("../../../model/User");
import { Room, RoomStatus, RoomType } from "../../../model/Room";
import TokenService from "../../../services/tokenService";
import * as chatroomService from "../../../services/chatroomService";

import Joi = require("joi");
import joiObj = require("joi-objectid");
Joi["objectId"] = joiObj(Joi);
import * as R from "ramda";

import withValidation from "../../../utils/ValidationSchema";

import { X_API_KEY, X_APP_ID, X_API_VERSION } from "../../../Const";
import { Config } from "../../../../config/config";
import { getUsersGroup } from "../../../util/ChannelHelper";
import ChannelService, { IUserGroup } from "../../../util/ChannelService";
import { UserSession, UserTransaction } from "../../../model/User";
const tokenService = new TokenService();
let channelService: ChannelService;

interface IUserData {
	_id: string;
	username: string;
	payload: any;
}

module.exports = (app) => {
	console.info("instanctiate connector handler.");
	return new Handler(app);
};

class Handler {
	private app;

	constructor(app) {
		this.app = app;
		channelService = app.get("channelService");
	}

	public login(msg, session, next) {
		const self = this;

		const schema = withValidation({
			user: Joi.object({
				_id: Joi.string().required(),
				username: Joi.string().required(),
				payload: Joi.any(),
			}).required(),
		});

		const result = Joi.validate(msg, schema);
		if (result.error) {
			return next(null, { code: Code.FAIL, message: result.error });
		}

		const user = { _id: msg.user._id, username: msg.user.username };
		const apiKey = msg[X_API_KEY];
		const appId = msg[X_APP_ID];
		const appVersion = msg[X_API_VERSION];
		if (R.contains(apiKey, Config.apiKeys) === false) {
			return next(null, { code: Code.FAIL, message: "authorized key fail." });
		}

		console.log("Login", user);
		tokenService.signToken(user, (err, encode) => {
			if (err) {
				return next(null, { code: Code.FAIL, message: err });
			} else {
				session.__sessionService__.kick(user._id, "New login...");

				// @ Signing success.
				session.bind(user._id);
				session.set(X_APP_ID, appId);
				session.set(X_API_KEY, apiKey);
				session.pushAll(() => { console.log("Push..."); });
				session.on("closed", onUserLeave.bind(null, self.app));

				// channelService.broadcast("connector", param.route, param.data);

				addOnlineUser(self.app, session, msg.user);
				next(null, { code: Code.OK, data: { success: true, token: encode } });
			}
		});
	}

	public logout(msg, session, next) {
		logOut(this.app, session, null);
		next();
	}

	public kickMe(msg, session, next) {
		session.__sessionService__.kick(msg.uid, "kick by logout all session", null);

		// !-- log user out.
		this.app.rpc.auth.authRemote.removeOnlineUser(session, msg.uid, null);

		next(null, { message: "kicked! " + msg.uid });
	}

	public updateUser(msg, session, next) {
		const self = this;

		const schema = withValidation({
			user: Joi.object({
				_id: Joi.string().required(),
				username: Joi.string().required(),
				payload: Joi.any(),
			}).required(),
		});

		const result = Joi.validate(msg, schema);
		if (result.error) {
			return next(null, { code: Code.FAIL, message: result.error });
		}

		const apiKey = msg[X_API_KEY];
		const appId = msg[X_APP_ID];
		const appVersion = msg[X_API_VERSION];
		if (R.contains(apiKey, Config.apiKeys) === false) {
			return next(null, { code: Code.FAIL, message: "authorized key fail." });
		}

		const p = new Promise((resolve: (value: UserSession) => void, rejected) => {
			self.app.rpc.auth.authRemote.getOnlineUser(session, session.uid, (err, userSession: UserSession) => {
				if (err) {
					rejected(err);
				} else {
					resolve(userSession);
				}
			});
		});

		function updateUser(user: UserSession) {
			const p2 = new Promise((resolve: (value: UserSession[]) => void, reject) => {
				self.app.rpc.auth.authRemote.updateUser(session, user, (err: Error, results: UserSession[]) => {
					if (err) {
						reject(err);
					} else {
						resolve(results);
					}
				});
			});
			return p2;
		}

		p.then((userSession) => {
			const user = mutateUserPayload(userSession, msg.user.payload);
			return updateUser(user);
		}).then((value) => {
			return next(null, { code: Code.OK, data: { success: true } });
		}).catch((err) => {
			return next(null, { code: Code.FAIL, message: err });
		});
	}

	public getUsersPayload(msg, session, next) {
		const self = this;

		const schema = withValidation(Object.create(null));

		const result = Joi.validate(msg, schema);
		if (result.error) {
			return next(null, { code: Code.FAIL, message: result.error });
		}

		const apiKey = msg[X_API_KEY];
		const appId = msg[X_APP_ID];
		const appVersion = msg[X_API_VERSION];
		if (R.contains(apiKey, Config.apiKeys) === false) {
			return next(null, { code: Code.FAIL, message: "authorized key fail." });
		}

		function getOnlineUserByAppId() {
			const p = new Promise((resolve: (value: UserSession[]) => void, reject) => {
				self.app.rpc.auth.authRemote.getOnlineUserByAppId(session, session.get(X_APP_ID),
					(err: Error, results: UserSession[]) => {
						if (err) {
							reject(err);
						} else {
							resolve(results);
						}
					});
			});

			return p;
		}

		getOnlineUserByAppId().then((usersSession) => {
			return usersSession;
		}).then((value) => {
			return next(null, { code: Code.OK, data: { success: true, value } });
		}).catch((err) => {
			return next(null, { code: Code.FAIL, message: err });
		});
	}

	/**
	 * New client entry chat server.
	 *
	 * @param  {Object}   msg     request message
	 * @param  {Object}   session current session object
	 * @param  {Function} next    next stemp callback
	 * @return {Void}
	 */
	public enterRoom(msg, session, next) {
		const self = this;
		const token = msg.token;
		const rid = msg.rid;
		const uname = msg.username;
		const uid = session.uid;

		if (!uid) {
			const errMsg = "session.uid is empty or null.!";
			next(null, { code: Code.FAIL, message: errMsg });
			return;
		}

		if (!rid || !msg.username) {
			next(null, { code: Code.FAIL, message: "rid or username is null." });
			return;
		}

		const timeOutId = setTimeout(() => {
			next(null, { code: Code.RequestTimeout, message: "enterRoom timeout" });
			return;
		}, Config.timeout);

		chatroomService.getRoom(rid).then((room: Room) => {
			console.log("getRoom", room);

			chatroomService.checkedCanAccessRoom(room, uid, (err, res) => {
				console.log("checkedCanAccessRoom: ", res);

				if (err || res === false) {
					clearTimeout(timeOutId);
					next(null, {
						code: Code.FAIL,
						message: "cannot access your request room. may be you are not a member or leaved room!",
					});
				} else {
					session.set("rid", rid);
					session.push("rid", (error: Error) => {
						if (error) {
							console.error("set rid for session service failed! error is : %j", error.stack);
						}
					});

					const onlineUser = new User.UserSession();
					onlineUser.username = uname;
					onlineUser.uid = uid;

					addChatUser(self.app, session, onlineUser, self.app.get("serverId"), rid, () => {
						clearTimeout(timeOutId);
						next(null, { code: Code.OK, data: room });
					});
				}
			});
		}).catch((err) => {
			clearTimeout(timeOutId);
			next(null, { code: Code.FAIL, message: JSON.stringify(err) });
		});
	}

	/**
	 * leaveRoom.
	 * For leave chat room.
	 * Require: roomId, username.
	 * Return: lastRoomAccess of roomId.
	 */
	public leaveRoom(msg, session, next) {
		const self = this;
		const token = msg.token;
		const rid = msg.rid;
		const uid = session.uid;
		const sid = self.app.get("serverId");

		const schema = {
			token: Joi.string().required(),
			rid: Joi.string().required(),
		};
		const result = Joi.validate(msg._object, schema);

		if (result.error) {
			return next(null, { code: Code.FAIL, message: result.error });
		}

		self.app.rpc.auth.authRemote.getUserTransaction(session, uid, (err, userTransaction: User.UserTransaction) => {
			self.app.rpc.chat.chatRemote.kick(session, userTransaction, sid, rid, function (err, res) {
				session.set("rid", null);
				session.push("rid", function (err) {
					if (err) {
						console.error("set rid for session service failed! error is : %j", err.stack);
					}
				});

				if (err) {
					next(null, { code: Code.FAIL, message: "leaveRoom with error." });
				}
				else {
					next(null, { code: Code.OK });
				}
			});
		});
	}

	/**
	* Requesting video call to target user.
	* @param {object} msg.targetId, myRtcId, token.
	*/
	public videoCallRequest(msg, session, next) {
		const targetId = msg.targetId;
		const uid = session.uid;
		const myRtcId = msg.myRtcId;
		const token = msg.token;
		const self = this;

		if (!targetId || !uid || !myRtcId) {
			next(null, { code: Code.FAIL, message: "some parametor has a problem." });
			return;
		}

		tokenService.ensureAuthorized(token, function (err, res) {
			if (err) {
				console.warn(err);
				next(err, res);
			}
			else {
				let onVideoCall = {
					route: Code.sharedEvents.onVideoCall,
					data: {
						from: uid,
						peerId: myRtcId
					}
				};
				let uidsGroup = new Array();

				self.app.rpc.auth.authRemote.getOnlineUser(session, targetId, (err, user) => {
					if (!err) {
						let group = {
							uid: user.uid,
							sid: user.serverId
						};
						uidsGroup.push(group);
						channelService.pushMessageByUids(onVideoCall.route, onVideoCall.data, uidsGroup);

						next(null, { code: Code.OK });
					}
					else {
						let msg = "target userId is not a list of onlineUser Please use notification server instead.";
						console.warn(msg);
						next(null, { code: Code.FAIL, message: msg });
					}
				});
			}
		});
	}

	/**
	* Requesting for voice call to target user.
	* @param {object} msg.targetId, myRtcId, token.
	*/
	public voiceCallRequest(msg, session, next) {
		const targetId = msg.targetId;
		const uid = session.uid;
		const myRtcId = msg.myRtcId;
		const token = msg.token;
		const self = this;

		if (!targetId || !uid || !myRtcId) {
			next(null, { code: Code.FAIL, message: "some parametor has a problem." });
			return;
		}

		tokenService.ensureAuthorized(token, function (err, res) {
			if (err) {
				console.warn(err);
				next(err, res);
			}
			else {
				const onVoiceCall = {
					route: Code.sharedEvents.onVoiceCall,
					data: {
						from: uid,
						peerId: myRtcId
					}
				};

				const uidsGroup = new Array();
				self.app.rpc.auth.authRemote.getOnlineUser(session, targetId, (e, user) => {
					if (!user) {
						const msg = "target userId is not a list of onlineUser Please use notification server instead.";
						console.warn(msg);
						next(null, { code: Code.FAIL, message: msg });
					}
					else {
						const group = {
							uid: user.uid,
							sid: user.serverId
						};
						uidsGroup.push(group);
						channelService.pushMessageByUids(onVoiceCall.route, onVoiceCall.data, uidsGroup);

						next(null, { code: Code.OK });
					}
				});
			}
		});
	}

	/**
	* Call this function when want to send hangupCall signaling to other.
	*/
	public hangupCall(msg, session, next) {
		const myId = msg.userId;
		const contactId = msg.contactId;
		const token = msg.token;
		const self = this;

		if (!myId || !contactId || !token) {
			next(null, { code: Code.FAIL, message: "some parametor has a problem." });
			return;
		}

		tokenService.ensureAuthorized(token, function (err, res) {
			if (err) {
				console.warn(err);
				next(err, res);
			}
			else {
				const onHangupCall = {
					route: Code.sharedEvents.onHangupCall,
					data: {
						from: myId,
						contactId,
					},
				};
				const uidsGroup = new Array();
				self.app.rpc.auth.authRemote.getOnlineUser(session, contactId, (e, user) => {
					if (!user) {
						const msg = "target userId is not a list of onlineUser Please use notification server instead.";
						console.warn(msg);
						next(null, { code: Code.FAIL, message: msg });
					}
					else {
						const group = {
							uid: user.uid,
							sid: user.serverId,
						};
						uidsGroup.push(group);
						channelService.pushMessageByUids(onHangupCall.route, onHangupCall.data, uidsGroup);

						next(null, { code: Code.OK });
					}
				});
			}
		});
	}

	/**
	* Call theLineIsBusy function when WebRTC call status is not idle.
	* This function tell caller to end call.
	*/
	public theLineIsBusy(msg, session, next) {
		const contactId = msg.contactId;
		const userId = session.uid;

		if (!contactId || !userId) {
			const message = "Some params is invalid.";
			next(null, { code: Code.FAIL, message });
			return;
		}

		const param = {
			route: Code.sharedEvents.onTheLineIsBusy,
			data: { from: userId },
		};

		this.app.rpc.auth.authRemote.getOnlineUser(session, contactId, (e, user) => {
			if (!user) {
				const msg = "The contactId is not online.";
				console.warn(msg);
			}
			else {
				const uidsGroup = new Array();
				const userInfo = {
					uid: user.uid,
					sid: user.serverId,
				};
				uidsGroup.push(userInfo);
				channelService.pushMessageByUids(param.route, param.data, uidsGroup);
			}
		});

		next(null, { code: Code.OK });
	}
}

const handler = Handler.prototype;

const logOut = (app, session, next) => {
	app.rpc.auth.authRemote.getOnlineUser(session, session.uid, (err, user) => {
		if (!err && user !== null) {
			console.log("logged out Success", user);

			const param = {
				route: Code.sharedEvents.onUserLogout,
				data: user,
			};

			app.rpc.auth.authRemote.getOnlineUserByAppId(session, session.get(X_APP_ID),
				(err2: Error, userSessions: UserSession[]) => {
					if (!err2) {
						console.log("online by app-id", userSessions.length);

						const uids = getUsersGroup(userSessions);
						channelService.pushMessageByUids(param.route, param.data, uids);
					}
				});
		}

		// !-- log user out.
		// Don't care what result of callback.
		app.rpc.auth.authRemote.removeOnlineUser(session, session.uid, null);
	});

	if (next !== null) {
		next();
	}
};

function mutateUserPayload(userSession: UserSession, payload: any) {
	userSession.payload = payload;

	return userSession;
}

function addOnlineUser(app, session, user: IUserData) {
	const userSession = new User.UserSession();
	const userTransaction = new User.UserTransaction();

	userSession.uid = user._id;
	userSession.username = user.username;
	userSession.serverId = session.frontendId;
	userSession.applicationId = session.get(X_APP_ID);
	userSession.payload = user.payload;

	userTransaction.uid = user._id;
	userTransaction.username = user.username;

	console.log("add to onlineUsers list : ", userSession.username);

	app.rpc.auth.authRemote.addOnlineUser(session, userSession, pushNewOnline);
	app.rpc.auth.authRemote.addUserTransaction(session, userTransaction, null);

	const param = {
		route: Code.sharedEvents.onUserLogin,
		data: userTransaction,
	};

	function pushNewOnline() {
		app.rpc.auth.authRemote.getOnlineUserByAppId(session, session.get(X_APP_ID), (err: Error, userSessions: UserSession[]) => {
			if (!err) {
				console.log("online by app-id", userSessions.length);

				const uids = getUsersGroup(userSessions);
				channelService.pushMessageByUids(param.route, param.data, uids);
			}
		});
	}
}

const addChatUser = (app, session, user: User.UserSession, sid, rid, next) => {
	// put user into channel
	app.rpc.chat.chatRemote.add(session, user, sid, rid, true, next);
};

/**
 * User log out handler
 * @param {Object} app current application
 * @param {Object} session current session object
 *
 */
const onUserLeave = (app, session) => {
	if (!session || !session.uid) {
		return;
	}

	app.rpc.auth.authRemote.getUserTransaction(session, session.uid, (err, userTransaction: User.UserTransaction) => {
		app.rpc.chat.chatRemote.kick(session, userTransaction, app.get("serverId"), session.get("rid"), null);

		logOut(app, session, null);
	});
};
