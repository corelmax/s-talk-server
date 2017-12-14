import async = require("async");

import ChannelService from "../../../util/ChannelService";
import { getUsersGroup } from "../../../util/ChannelHelper";
import Code, { SessionInfo } from "../../../../shared/Code";
import { X_APP_ID } from "../../../Const";
import User, { UserSession } from "../../../model/User";
import * as Room from "../../../model/Room";
import { Config } from "../../../../config/config";
import withValidation from "../../../utils/ValidationSchema";
import Joi = require("joi");
let channelService: ChannelService;

interface IPushMessage {
    event: string;
    message: string;
    members: string[] | string;
}

module.exports = function (app) {
    return new Handler(app);
};

const Handler = function (app) {
    console.info("pushHandler construc...");
    this.app = app;
    channelService = this.app.get("channelService");
};

const handler = Handler.prototype;

handler.push = function (msg, session, next) {
    let self = this;
    let schema = withValidation({
        payload: Joi.object({
            event: Joi.string().required(),
            message: Joi.string().required(),
            members: Joi.any(),
        }).required(),
    });

    const result = Joi.validate(msg, schema);
    if (result.error) {
        return next(null, { code: Code.FAIL, message: result.error });
    }

    let timeout_id = setTimeout(function () {
        next(null, { code: Code.RequestTimeout, message: "Push message timeout..." });
    }, Config.timeout);

    // <!-- send callback to user who send push msg.
    let sessionInfo: SessionInfo = { id: session.id, frontendId: session.frontendId, uid: session.uid };
    let params = {
        session: sessionInfo
    };
    next(null, { code: Code.OK, data: params });
    clearTimeout(timeout_id);

    pushMessage(self.app, session, msg.payload);
};

function pushMessage(app, session, body: IPushMessage) {
    let onlineMembers = new Array<UserSession>();
    let offlineMembers = new Array<string>();

    // @ Try to push message to others.
    if (body.members == "*") {
        let param = {
            route: Code.sharedEvents.ON_PUSH,
            data: { event: body.event, message: body.message }
        };

        app.rpc.auth.authRemote.getOnlineUserByAppId(session, session.get(X_APP_ID), (err: Error, userSessions: Array<UserSession>) => {
            if (!err) {
                console.log("online by app-id", userSessions.length);

                let uids = getUsersGroup(userSessions);
                channelService.pushMessageByUids(param.route, param.data, uids);
            }
        });
        // channelService.broadcast("connector", onPush.route, onPush.data);
    }
    else if (body.members instanceof Array) {
        async.map(body.members, (item, resultCallback) => {
            app.rpc.auth.authRemote.getOnlineUser(session, item, function (err, user) {
                if (err || user === null) {
                    offlineMembers.push(item);
                }
                else {
                    onlineMembers.push(user);
                }

                resultCallback(undefined, item);
            });
        }, (err, results) => {
            console.log("online %s: offline %s: push.members %s:", onlineMembers.length, offlineMembers.length, body.members.length);

            // <!-- push chat data to other members in room.
            let onPush = {
                route: Code.sharedEvents.ON_PUSH,
                data: { event: body.event, message: body.message }
            };

            // <!-- Push new message to online users.
            let uidsGroup = new Array();
            async.map(onlineMembers, function iterator(val, cb) {
                let group = {
                    uid: val.uid,
                    sid: val.serverId
                };
                uidsGroup.push(group);

                cb(undefined, undefined);
            }, function done() {
                channelService.pushMessageByUids(onPush.route, onPush.data, uidsGroup);

                // <!-- Push message to off line users via parse.
                if (!!offlineMembers && offlineMembers.length > 0) {
                    // simplePushNotification(app, session, offlineMembers, room, message.sender);
                }
            });
        });
    }
}