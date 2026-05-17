<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return response()->json(['status' => 'ok', 'name' => 'example-laravel-app']);
});

Route::get('/items/{id}', function (string $id) {
    if (!preg_match('/^[a-zA-Z0-9_-]{1,32}$/', $id)) {
        return response()->json(['error' => 'invalid id'], 400);
    }
    return response()->json(['id' => $id, 'name' => "item-{$id}"]);
});

Route::post('/items', function (Request $request) {
    $name = $request->input('name');
    if (!is_string($name) || $name === '') {
        return response()->json(['error' => 'name required'], 400);
    }
    return response()->json(['id' => 'new', 'name' => $name], 201);
});
