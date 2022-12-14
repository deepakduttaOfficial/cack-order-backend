import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import cloudinary from "cloudinary";

import User from "../models/user.shema.js";
import asyncHandler from "../services/asyncHandler.js";
import CustomError from "../services/errorHandler.js";
import envConfig from "../config/env.config.js";
import authMailSender from "../services/authMailSender.js";
import resetPasswordMailSender from "../services/resetPasswordMailSender.js";

export const signup = asyncHandler(async (req, res) => {
  // Extact data from body
  const { name, email, password } = req.body;
  if (!(name && email && password)) {
    throw new CustomError("All field are required", 400);
  }
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new CustomError("User already exists", 400);
  }

  const verifyToken = jwt.sign(
    { id: uuidv4() },
    envConfig.EMAIL_VERIFY_TOKEN_SECRET_KEY,
    {
      expiresIn: "1h",
    }
  );

  const data = { name, email, password, verifyToken };

  const user = await User.create(data);

  user.password = undefined;

  const options = { email, name, verifyToken };
  authMailSender(options, req);

  res.status(200).json({
    success: true,
    user,
  });
});

export const signin = asyncHandler(async (req, res) => {
  // Extact data from body
  const { email, password } = req.body;
  if (!(email && password)) {
    throw new CustomError("All field are required", 400);
  }
  const user = await User.findOne({ email });

  if (!(user && (await user.comparePassword(password)))) {
    throw new CustomError("Invalid email or password.", 400);
  }

  // Check how many time user is longing our app
  await User.findByIdAndUpdate(
    user._id,
    { $inc: { loginCount: 1 } },
    { new: true }
  );

  user.password = undefined;
  user.resetPasswordExpires = undefined;
  user.resetPasswordToken = undefined;
  user.verifyToken = undefined;

  const token = user.authJwtToken();

  res.cookie("sign_in", token, {
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    httpOnly: true,
  });

  res.status(200).json({
    success: true,
    user,
    sign_in: token,
  });
});

export const getUserFromToken = asyncHandler(async (req, res) => {
  // Extact data from body
  const user = await User.findById(req.auth._id);
  if (!user) return res.status(400).json({ error: "Invalid User" });

  user.password = undefined;
  user.resetPasswordExpires = undefined;
  user.resetPasswordToken = undefined;
  user.verifyToken = undefined;

  res.status(200).json({
    success: true,
    user,
  });
});

export const recoverPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw new CustomError("Enter email address", 400);
  const getUser = await User.findOne({ email });
  if (!getUser) throw new CustomError("User not found", 400);

  getUser.generateResetPasswordToken();

  const user = await getUser.save();

  let link = `${envConfig.DOMAIN_URL}/account/reset-password?id=${user._id}&reset_password_token=${user.resetPasswordToken}`;

  const options = { email, name: user.name, link };

  resetPasswordMailSender(options);
  return res.status(200).json({
    success: true,
    message: "Chack you mail and reset your password",
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { password, id, reset_password_token } = req.body;

  if (!(id?.length === 24 && reset_password_token))
    throw new CustomError("Invalid url", 400);

  const user = await User.findOne({
    _id: id,
    resetPasswordExpires: { $gt: Date.now() },
  });

  if (!user) throw new CustomError("Password reset token has expired.", 400);

  if (user.resetPasswordToken !== reset_password_token) {
    throw new CustomError("Password reset token is invalid", 400);
  }
  if (!(password?.length >= 4))
    throw new CustomError("Password must be 4 charecter long", 400);

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;

  await user.save();

  return res.status(200).json({
    success: true,
    message: "Password changed successfully",
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { name } = req.body;

  const user = req.user;
  const data = { name };

  if (req.files) {
    const file = req.files.photo;
    if (user?.photo?.public_id) {
      await cloudinary.v2.uploader.destroy(user.photo.public_id);
    }
    let result = await cloudinary.v2.uploader.upload(file.tempFilePath, {
      folder: "cack_order/users",
    });

    data.photo = {
      public_id: result.public_id,
      secure_url: result.secure_url,
    };
  }
  const updatedUser = await User.findByIdAndUpdate(user._id, data, {
    new: true,
  });
  updatePassword.password = undefined;
  return res.status(200).json({
    success: true,
    message: updatedUser,
  });
});

export const updatePassword = asyncHandler(async (req, res) => {
  const { old_password, new_password } = req.body;
  const user = await User.findById(req.user._id);

  if (!(await user.comparePassword(old_password)))
    throw new CustomError("Old password is wrong");

  user.password = new_password;
  await user.save();

  updatePassword.password = undefined;

  return res.status(200).json({
    success: true,
    message: user,
  });
});

// Admin controllers
export const adminGetAllUser = asyncHandler(async (req, res) => {
  const users = await User.find();
  for (const user of users) {
    user.password = undefined;
  }
  return res.status(200).json({
    success: true,
    users,
  });
});

export const adminUpdateRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!role) throw new CustomError("Role is requried", 400);

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { role },
    { new: true }
  );
  user.password = undefined;
  return res.status(200).json({
    success: true,
    user,
  });
});
