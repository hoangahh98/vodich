package com.vodich.web;

import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

@ControllerAdvice
public class AppExceptionHandler {
    @ExceptionHandler(IllegalStateException.class)
    public String forbidden(IllegalStateException ex, Model model) {
        model.addAttribute("message", ex.getMessage());
        return "error";
    }
}
