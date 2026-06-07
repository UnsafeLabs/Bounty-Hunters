<?php

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

// Suppress error display in production
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');

// Hide PHP version from HTTP headers
ini_set('expose_php', '0');

// Set sensible defaults for production
ini_set('log_errors', '1');
ini_set('error_reporting', 'E_ALL & ~E_DEPRECATED & ~E_STRICT');

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require __DIR__.'/../vendor/autoload.php';

// Bootstrap Laravel and handle the request...
/** @var Application $app */
$app = require_once __DIR__.'/../bootstrap/app.php';

$app->handleRequest(Request::capture());
