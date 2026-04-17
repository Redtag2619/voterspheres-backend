import { assertBetaAccess } from "../services/betaAccess.service.js";

export function requireBetaAccessForSignup(req, res, next) {
  try {
    const email = req.body?.email;
    const inviteCode = req.body?.invite_code || req.body?.inviteCode || "";

    assertBetaAccess(email, {
      allowInviteCode: true,
      inviteCode
    });

    return next();
  } catch (error) {
    return res.status(error.status || 403).json({
      error:
        error.message ||
        "VoterSpheres is currently in a private beta. Your email is not approved yet."
    });
  }
}

export function requireBetaAccessForLogin(req, res, next) {
  try {
    const email = req.body?.email;

    assertBetaAccess(email, {
      allowInviteCode: false
    });

    return next();
  } catch (error) {
    return res.status(error.status || 403).json({
      error:
        error.message ||
        "VoterSpheres is currently in a private beta. Your email is not approved yet."
    });
  }
}
