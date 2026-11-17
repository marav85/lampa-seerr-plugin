(function () {
    'use strict';

    if (window.plugin_seerr_upcoming_ready) return;
    window.plugin_seerr_upcoming_ready = true;

    const PLUGIN_NAME = 'Seerr Upcoming';
    const PLUGIN_ID = 'seerr_upcoming';

    const MENU_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path><path d="M16 18h.01"></path></svg>`;

    const GENRES = {
        all: 'Все жанры', 28: 'Боевик', 12: 'Приключения', 16: 'Мультфильм',
        35: 'Комедия', 80: 'Криминал', 99: 'Документальный', 18: 'Драма',
        10751: 'Семейный', 14: 'Фэнтези', 36: 'История', 27: 'Ужасы',
        10402: 'Музыка', 9648: 'Детектив', 10749: 'Мелодрама', 878: 'Фантастика',
        53: 'Триллер', 10752: 'Военный', 37: 'Вестерн'
    };

    function getYearsList() {
        const currentYear = new Date().getFullYear();
        const years = { all: 'Все годы' };
        for (let y = currentYear + 2; y >= currentYear - 5; y--) {
            years[y.toString()] = y.toString();
        }
        return years;
    }

    function SeerrCatalogComponent(object) {
        const network = new Lampa.Reguest();
        const scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        const html = $('<div></div>');
        const body = $('<div class="category-full"></div>');
        
        let items = [];
        let active = false;
        let last_focused;
        let page = 1;
        let total_pages = 1;
        let loading = false;

        let filters = {
            type: 'movie',
            genre: 'all',
            year: 'all',
            sort: 'popularity.desc'
        };

        this.create = function () {
            this.activity.loader(true);
            this.renderHeader();
            html.append(scroll.render());
            scroll.append(body);

            scroll.onEnd = () => {
                if (!loading && page < total_pages) {
                    page++;
                    this.loadData(true);
                }
            };

            this.loadData(false);
            return this.render();
        };

        this.renderHeader = function () {
            const header = $(`
                <div class="seerr-filter-bar" style="padding: 1.5em 1.5em 0.5em 1.5em; display: flex; gap: 1em; flex-wrap: wrap;">
                    <div class="simple-button selector filter-type">Тип: Фильмы</div>
                    <div class="simple-button selector filter-genre">Жанр: Все жанры</div>
                    <div class="simple-button selector filter-year">Год: Все годы</div>
                    <div class="simple-button selector filter-sort">Сортировка: Популярные</div>
                </div>
            `);

            header.find('.filter-type').on('hover:enter', () => this.openSelect('Тип контента', {
                movie: 'Фильмы',
                tv: 'Сериалы'
            }, 'type', '.filter-type', 'Тип: '));

            header.find('.filter-genre').on('hover:enter', () => this.openSelect('Выберите жанр', GENRES, 'genre', '.filter-genre', 'Жанр: '));
            header.find('.filter-year').on('hover:enter', () => this.openSelect('Год релиза', getYearsList(), 'year', '.filter-year', 'Год: '));
            header.find('.filter-sort').on('hover:enter', () => this.openSelect('Сортировка', {
                'popularity.desc': 'Популярные',
                'release_date.asc': 'По дате (сначала ближайшие)',
                'vote_average.desc': 'По рейтингу'
            }, 'sort', '.filter-sort', 'Сортировка: '));

            html.prepend(header);
        };

        this.openSelect = function (title, listObj, filterKey, btnSelector, prefix) {
            const selectItems = Object.keys(listObj).map(key => ({
                title: listObj[key],
                value: key,
                selected: filters[filterKey] === key
            }));

            Lampa.Select.show({
                title: title,
                items: selectItems,
                onSelect: (selected) => {
                    filters[filterKey] = selected.value;
                    html.find(btnSelector).text(prefix + selected.title);
                    this.resetAndReload();
                },
                onBack: () => {
                    Lampa.Controller.toggle('content');
                }
            });
        };

        this.resetAndReload = function () {
            page = 1;
            items = [];
            last_focused = null;
            body.empty();
            this.activity.loader(true);
            this.loadData(false);
        };
        this.loadData = function (append) {
            const domain = Lampa.Storage.get('seerr_url', '').replace(/\/+$/, '');
            const apiKey = Lampa.Storage.get('seerr_api_key', '');

            if (!domain || !apiKey) {
                this.activity.loader(false);
                Lampa.Noty.show('Укажите URL сервера и API Key в настройках Lampa -> Seerr');
                return;
            }

            loading = true;
            const today = new Date().toISOString().split('T');
            const isMovie = filters.type === 'movie';
            const endpoint = isMovie ? '/api/v1/discover/movies' : '/api/v1/discover/tv';
            
            // Исправляем сортировку для сериалов (в TMDB/Seerr разные названия полей дат)
            let sortValue = filters.sort;
            if (sortValue === 'release_date.asc') {
                sortValue = isMovie ? 'primary_release_date.asc' : 'first_air_date.asc';
            }

            let params = [
                `page=${page}`,
                `language=ru`,
                `sortBy=${sortValue}`
            ];

            // Корректная фильтрация дат без дублирования параметров
            const dateGteKey = isMovie ? 'primaryReleaseDateGte' : 'firstAirDateGte';
            const dateLteKey = isMovie ? 'primaryReleaseDateLte' : 'firstAirDateLte';

            if (filters.year === 'all') {
                params.push(`${dateGteKey}=${today}`);
            } else {
                params.push(`${dateGteKey}=${filters.year}-01-01`);
                params.push(`${dateLteKey}=${filters.year}-12-31`);
            }

            if (filters.genre !== 'all') {
                params.push(`genre=${filters.genre}`);
            }

            const url = `${domain}${endpoint}?${params.join('&')}`;

            network.clear();
            network.timeout(10000);
            network.native(url, (json) => {
                loading = false;
                this.activity.loader(false);

                if (json && json.results && json.results.length > 0) {
                    total_pages = json.totalPages || 1;
                    this.buildCards(json.results);
                } else if (!append) {
                    body.append('<div class="empty__title" style="padding: 2em;">Ничего не найдено</div>');
                }
                
                if (!append) this.start();
            }, (error) => {
                loading = false;
                this.activity.loader(false);
                Lampa.Noty.show('Ошибка API Seerr: ' + (error.status || 'Сетевая ошибка'));
                console.error('[Seerr Plugin Error]', url, error);
                if (!append) this.start();
            }, false, {
                headers: {
                    'X-Api-Key': apiKey,
                    'Accept': 'application/json'
                }
            });
        };

        this.buildCards = function (results) {
            results.forEach(element => {
                const cardData = {
                    id: element.id,
                    title: element.title || element.name,
                    original_title: element.originalTitle || element.originalName,
                    release_date: element.releaseDate || element.firstAirDate || '',
                    poster_path: element.posterPath,
                    backdrop_path: element.backdropPath,
                    vote_average: element.voteAverage || 0,
                    overview: element.overview,
                    source: 'tmdb',
                    media_type: filters.type
                };

                const card = Lampa.Template.get('card', {
                    title: cardData.title,
                    release_year: cardData.release_date ? cardData.release_date.slice(0, 4) : 'Скоро'
                });

                if (element.mediaInfo && element.mediaInfo.status) {
                    const statusMap = {
                        2: { text: 'Запрошено', color: '#e67e22' },
                        3: { text: 'Обработка', color: '#3498db' },
                        4: { text: 'Частично', color: '#9b59b6' },
                        5: { text: 'Доступно', color: '#2ecc71' }
                    };
                    const st = statusMap[element.mediaInfo.status];
                    if (st) {
                        card.find('.card__view').append(
                            `<div class="card__quality" style="background: ${st.color}; color: #fff;">${st.text}</div>`
                        );
                    }
                }

                // ИСПРАВЛЕНО: корректная загрузка постера через jQuery .attr() и прокси TMDB Lampa
                const img = card.find('.card__img');
                if (cardData.poster_path) {
                    img.attr('src', Lampa.TMDB.image('t/p/w300' + cardData.poster_path));
                } else {
                    img.attr('src', './img/img_broken.svg');
                }

                card.on('hover:focus', (e) => {
                    last_focused = e.target;
                    scroll.update(card, true);
                });

                card.on('hover:enter', () => {
                    Lampa.Activity.push({
                        url: '',
                        component: 'full',
                        id: cardData.id,
                        method: filters.type,
                        card: cardData,
                        source: 'tmdb'
                    });
                });

                body.append(card);
                items.push(card);
            });

            if (active) Lampa.Controller.collectionSet(this.render());
        };

        this.start = function () {
            active = true;
            Lampa.Controller.add('content', {
                toggle: () => {
                    Lampa.Controller.collectionSet(this.render());
                    Lampa.Controller.collectionFocus(last_focused || false, this.render());
                },
                left: () => {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: () => Navigator.move('right'),
                up: () => {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: () => Navigator.move('down'),
                back: () => Lampa.Activity.backward()
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () { active = false; };
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () {
            network.clear();
            scroll.destroy();
            html.remove();
        };
    }

    function initPlugin() {
        Lampa.Component.add(PLUGIN_ID, SeerrCatalogComponent);

        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            name: PLUGIN_NAME,
            icon: MENU_ICON
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: 'seerr_url', type: 'input', values: '', default: 'https://example.com' },
            field: { name: 'URL сервера Seerr', description: 'Например: https://mydomain.ru (без слеша в конце)' }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: { name: 'seerr_api_key', type: 'input', values: '', default: '' },
            field: { name: 'API Key', description: 'Ключ из настроек Seerr (Settings -> General -> API Key)' }
        });

        const menuItem = $(`
            <li class="menu__item selector" data-action="${PLUGIN_ID}">
                <div class="menu__ico">${MENU_ICON}</div>
                <div class="menu__text">${PLUGIN_NAME}</div>
            </li>
        `);

        menuItem.on('hover:enter', () => {
            Lampa.Activity.push({ url: '', title: PLUGIN_NAME, component: PLUGIN_ID, page: 1 });
        });

        $('.menu .menu__list').eq(0).append(menuItem);
    }

    if (window.appready) {
        initPlugin();
    } else {
        Lampa.Listener.follow('app', (e) => {
            if (e.type === 'ready') initPlugin();
        });
    }
})();
