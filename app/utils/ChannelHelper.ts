import { UserSession } from "../model/User";

type UserGroup = {
    uid: string;
    sid: string;
}
export function getUsersGroup(users: Array<UserSession>) {
    let usersGroup = [] as Array<UserGroup>;

    usersGroup = users.map(user => {
        return { uid: user.uid, sid: user.serverId };
    });

    return usersGroup;
}

export function withoutUser(usersGroups: UserGroup[], uid: string) {
    return usersGroups.filter(user => user.uid != uid);
}

export default getUsersGroup;