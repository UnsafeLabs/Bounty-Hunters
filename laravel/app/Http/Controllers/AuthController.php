<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class AuthController extends Controller
{
    public function register(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', 'unique:users'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Validation failed',
                'errors' => $validator->errors(),
            ], 422);
        }

        $user = User::create([
            'name' => $request->name,
            'email' => $request->email,
            'password' => Hash::make($request->password),
        ]);

        $tokenObj = $user->createToken('api-token');

        return response()->json([
            'message' => 'User registered successfully',
            'user' => $user,
            'token' => $tokenObj->plainTextToken,
        ], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Validation failed',
                'errors' => $validator->errors(),
            ], 422);
        }

        $user = User::where('email', $request->email)->first();

        if (! $user || ! Hash::check($request->password, $user->password)) {
            return response()->json([
                'message' => 'Invalid credentials',
            ], 401);
        }

        $tokenObj = $user->createToken('api-token');

        return response()->json([
            'message' => 'Login successful',
            'user' => $user,
            'token' => $tokenObj->plainTextToken,
        ], 200);
    }

    public function logout(Request $request): JsonResponse
    {
        $user = AuthController::resolveUserFromToken($request);

        if ($user) {
            $user->forceFill(['remember_token' => null])->save();
        }

        return response()->json([
            'message' => 'Logged out successfully',
        ], 200);
    }

    private static function resolveUserFromToken(Request $request): ?User
    {
        $header = $request->header('Authorization', '');
        if (! str_starts_with($header, 'Bearer ')) {
            return null;
        }

        $token = substr($header, 7);
        $hashedToken = hash('sha256', $token);

        return User::where('remember_token', $hashedToken)->first();
    }
}
