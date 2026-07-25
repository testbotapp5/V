const userStates = {};

const setState   = (uid, s) => { userStates[String(uid)] = s; };
const getState   = (uid)    => userStates[String(uid)] || null;
const clearState = (uid)    => { delete userStates[String(uid)]; };

module.exports = { setState, getState, clearState };
