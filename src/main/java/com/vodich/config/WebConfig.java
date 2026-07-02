package com.vodich.config;

import com.vodich.auth.AuthSession;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Component
public class WebConfig implements WebMvcConfigurer {
    private final AuthSession authSession;

    public WebConfig(AuthSession authSession) {
        this.authSession = authSession;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override
            public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
                String path = request.getRequestURI();
                if (path.startsWith("/css/") || path.startsWith("/js/") || path.startsWith("/ws")
                    || path.equals("/login") || path.startsWith("/external-register")) {
                    return true;
                }
                if (!authSession.isLoggedIn(request.getSession())) {
                    response.sendRedirect("/login");
                    return false;
                }
                return true;
            }
        });
    }
}
