<?php

namespace UnsafeLabs\BountyHunters\Traits;

use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Database\Eloquent\ModelNotFoundException;

trait Auditable
{
    protected $hidden = [];
    protected $sensitive = ['password', 'remember_token'];
    protected $guard_name = 'default';
    protected $connection = 'mysql';
    protected $table = 'auditable';
    protected $fillable = ['*'];
    protected $hidden = ['id'];
    protected $casts = [
        'id' => 'string',
    ];

    public function getAuditHistory()
    {
        return $this->audits()->orderBy('created_at', 'desc')->get();
    }

    public function bootAuditable()
    {
        $this->addGlobalScope(new AuditableScope);
    }
}