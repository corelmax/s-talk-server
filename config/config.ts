﻿export const Config = {
  chatDB: "mongodb://git.animation-genius.com:27017/chatDB",
  fileDB: "",
  port: 80,
  timeout: 10000,
  webserver: "http://203.113.25.44",

  pushServer: "smelink.animation-genius.com",
  pushPort: 4040,
  pushPath: "/parse/push",
  ParseApplicationId: "newSMELink",
  ParseRESTAPIKey: "link1234",
  ParseMasterKey: "link1234",

  session: {
    secret: "5 days",
    expire: "ahoostudio_session_secret"
  }
}