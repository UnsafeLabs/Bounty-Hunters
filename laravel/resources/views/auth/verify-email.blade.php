<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Email</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Robben, sans-serif; line-height: 1.6; color: #333; max-width: 580px; margin: 40px auto; padding: 20px; }
        .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 32px; background: #fff; text-align: center; }
        .btn { display: inline-block; padding: 12px 24px; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 16px; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Email Verification Required</h1>
        <p>Please verify your email address to access this page.</p>
        <p>If you did not receive the email, click the button below to request another.</p>
        <form method="POST" action="{{ route('verification.send') }}">
            @csrf
            <button type="submit" class="btn">Resend Verification Email</button>
        </form>
        @if (session('message'))
            <p style="color: #16a34a; margin-top: 16px;">{{ session('message') }}</p>
        @endif
    </div>
</body>
</html>
