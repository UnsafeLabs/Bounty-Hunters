<?php

namespace Tests\Unit;

use Illuminate\Database\Eloquent\Model;
use Tests\TestCase;

class LazyLoadingPreventionTest extends TestCase
{
    public function test_lazy_loading_prevention_is_enabled_in_testing_environment(): void
    {
        $this->assertTrue(app()->environment('testing'));
        $this->assertTrue(Model::preventsLazyLoading());
    }
}
