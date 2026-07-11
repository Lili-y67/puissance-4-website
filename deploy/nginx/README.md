# Page offline Nginx

Cette page remplace le `502 Bad Gateway` brut quand Node ou le panel Puissance 4 est down.

## Installation VPS

1. Copier la page:

```bash
sudo mkdir -p /var/www/puissance4-offline
sudo cp offline.html /var/www/puissance4-offline/offline.html
```

2. Dans le bloc Nginx du site, ajouter:

```nginx
error_page 502 503 504 /offline.html;

location = /offline.html {
    root /var/www/puissance4-offline;
    internal;
    add_header Cache-Control "no-store";
}
```

3. Dans le `location /` qui proxy vers Node, ajouter:

```nginx
proxy_intercept_errors on;
```

4. Tester puis recharger:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Si le site utilise deja un bloc HTTPS `server { listen 443 ssl; ... }`, mets ces directives dans ce bloc-la aussi.
