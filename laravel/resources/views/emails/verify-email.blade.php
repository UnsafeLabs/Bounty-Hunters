<h1>Welcome to Laravel</h1>

<p>Hello {{ $user->name ?? 'there' }},</p>

<p>Please verify your email address to finish setting up your account.</p>

<p>
    <a href="{{ $url }}">Verify email address</a>
</p>

<p>If you did not create this account, no further action is required.</p>
