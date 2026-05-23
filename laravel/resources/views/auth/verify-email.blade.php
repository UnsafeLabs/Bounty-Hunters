<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verify Email</title>
</head>
<body>
    <h1>Verify your email address</h1>
    <p>Please check your inbox for a verification link before continuing.</p>

    @if (session('status') === 'verification-link-sent')
        <p>A new verification link has been sent to your email address.</p>
    @endif
</body>
</html>
